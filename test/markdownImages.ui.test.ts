// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { livePreview } from '../src/ui/livePreview';
import { refreshPreview } from '../src/ui/previewState';
import { App } from '../src/ui/app';
import { MemoryAdapter } from '../src/adapters/memory';
import { VaultService } from '../src/core/vault/VaultService';
import { EmbedResolver } from '../src/ui/embed/embedResolver';
import { externalImageSource, localImagePath } from '../src/ui/embed/imageSource';
import { LAYOUT_PATH } from '../src/core/settings/workspaceLayout';

const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
const views: EditorView[] = [];
beforeAll(() => {
  Object.assign(Range.prototype, {
    getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    getClientRects: () => Object.assign([], { item: () => null }),
  });
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never;
});
beforeEach(() => {
  let id = 0;
  URL.createObjectURL = vi.fn(() => `blob:test/image-${++id}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});
const settle = async (): Promise<void> => {
  for (let i = 0; i < 15; i++) await new Promise(resolve => setTimeout(resolve, 0));
};
async function start(adapter: MemoryAdapter): Promise<HTMLElement> {
  const root = document.createElement('div');
  document.body.append(root);
  await new App(root, {
    supported: false, unsupportedReason: '', restore: async () => adapter,
    hasSaved: async () => true, pick: async () => adapter, demo: async () => adapter,
  }).start();
  return root;
}
function editor(doc: string, enabled: () => boolean, resolve = vi.fn(async () => 'blob:test/source')) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const view = new EditorView({ parent, state: EditorState.create({ doc, extensions: [
    markdown(), livePreview(enabled, { context: () => 'Notes/Test.md', resolve }),
  ] }) });
  views.push(view);
  return { view, parent, resolve };
}

describe('Markdownの通常画像プレビュー', () => {
  it.each([
    ['![説明](images/photo.png)', 'images/photo.png', '説明', undefined],
    ['![画像](<images/my photo.png> "タイトル")', 'images/my photo.png', '画像', 'タイトル'],
    ['![a](images/photo\\(1\\).png)', 'images/photo(1).png', 'a', undefined],
    ['![a](https://example.com/image?x=1&amp;y=2)', 'https://example.com/image?x=1&y=2', 'a', undefined],
    ['![説明][pic]\n\n[pic]: images/photo.png "参照タイトル"', 'images/photo.png', '説明', '参照タイトル'],
    ['![pic][]\n\n[pic]: images/photo.png', 'images/photo.png', 'pic', undefined],
    ['![pic]\n\n[pic]: images/photo.png', 'images/photo.png', 'pic', undefined],
  ])('%s を構文木から描画する', async (source, target, alt, title) => {
    const { parent, resolve } = editor(`# Note\n\n${source}`, () => true);
    await settle();
    const image = parent.querySelector<HTMLImageElement>('.cm-md-image img')!;
    expect(image).not.toBeNull();
    expect(image.src).toBe('blob:test/source');
    expect(image.alt).toBe(alt);
    expect(image.getAttribute('title')).toBe(title ?? null);
    expect(resolve).toHaveBeenCalledWith(target, 'Notes/Test.md');
  });

  it('カーソル行・コード内・Live Preview OFFはソースを残す', async () => {
    let enabled = true;
    const source = '# Note\n\n![a](photo.png)\n\n`![b](code.png)`\n\n```md\n![c](fenced.png)\n```';
    const { parent, resolve, view } = editor(source, () => enabled);
    await settle();
    expect(parent.querySelectorAll('.cm-md-image img')).toHaveLength(1);
    expect(resolve).toHaveBeenCalledTimes(1);
    const line = view.state.doc.line(3).from;
    view.dispatch({ selection: { anchor: line } });
    expect(parent.querySelector('.cm-md-image')).toBeNull();
    expect(parent.textContent).toContain('![a](photo.png)');
    view.dispatch({ selection: { anchor: 0 } });
    await settle();
    expect(parent.querySelector('.cm-md-image img')).not.toBeNull();
    enabled = false;
    view.dispatch({ effects: refreshPreview.of(null) });
    expect(parent.querySelector('.cm-md-image')).toBeNull();
    expect(parent.textContent).toContain('![a](photo.png)');
  });

  it('読み込み失敗を本文を書き換えずに表示する', async () => {
    const resolve = vi.fn(async (): Promise<string> => { throw new Error('ENOENT'); });
    const source = '# Note\n\n![無い画像](missing.png)';
    const { parent, view } = editor(source, () => true, resolve);
    await settle();
    expect(parent.querySelector('.cm-embed-missing')?.textContent).toContain('無い画像');
    expect(view.state.doc.toString()).toBe(source);
  });

  it('同一行の選択移動では画像のDOMや読み込みを作り直さない', async () => {
    const { parent, view, resolve } = editor('# Note text\n\n![a](photo.png)', () => true);
    await settle();
    const image = parent.querySelector('img');
    view.dispatch({ selection: { anchor: 4 } });
    await settle();
    expect(parent.querySelector('img')).toBe(image);
    expect(resolve).toHaveBeenCalledOnce();
  });

  it.each(['![図](images/photo.png)', '![[images/photo.png]]'])('ノートを切り替えると同じ%sでもそれぞれのフォルダを参照する', async (syntax) => {
    const adapter = new MemoryAdapter('Markdown images');
    const source = `# Note\n\n${syntax}`;
    for (const dir of ['A', 'B']) {
      await adapter.write(`${dir}/Note.md`, source);
      await adapter.writeBinary(`${dir}/images/photo.png`, new Uint8Array([1]).buffer);
    }
    const root = await start(adapter);
    root.querySelector<HTMLElement>('.row[data-path="A/Note.md"]')!.click();
    await settle();
    const first = root.querySelector<HTMLImageElement>('.cm-embed-image')!.src;
    root.querySelector<HTMLElement>('.row[data-path="B/Note.md"]')!.click();
    await settle();
    expect(root.querySelector<HTMLImageElement>('.cm-embed-image')!.src).not.toBe(first);
    expect(await adapter.read('A/Note.md')).toBe(source);
    expect(await adapter.read('B/Note.md')).toBe(source);
  });

  it.each(['![図](images/photo.png)', '![[images/photo.png]]'])('分割した両ペインの%sは自分のノートから解決する', async (syntax) => {
    const adapter = new MemoryAdapter('Split images');
    for (const dir of ['A', 'B']) {
      await adapter.write(`${dir}/Note.md`, `# Note\n\n${syntax}`);
      await adapter.writeBinary(`${dir}/images/photo.png`, new Uint8Array([1]).buffer);
    }
    await adapter.write(LAYOUT_PATH, JSON.stringify({ panes: [
      { tabs: ['A/Note.md'], active: 'A/Note.md' }, { tabs: ['B/Note.md'], active: 'B/Note.md' },
    ], activePane: 1 }));
    const root = await start(adapter);
    await settle();
    const images = [...root.querySelectorAll<HTMLImageElement>('.cm-embed-image')];
    expect(images).toHaveLength(2);
    expect(images[0]!.src).not.toBe(images[1]!.src);
  });
});

describe('Markdown画像の安全な参照解決', () => {
  it('相対パス、Vaultルート、クエリ、日本語・空白を扱う', () => {
    expect(localImagePath('images/%E5%9B%B3%20a.png?v=1#x', 'Notes/Test.md')).toBe('Notes/images/図 a.png');
    expect(localImagePath('../assets/a.png', 'Notes/Test.md')).toBe('assets/a.png');
    expect(localImagePath('/assets/a.png', 'Notes/Test.md')).toBe('assets/a.png');
  });
  it.each(['../../outside.png', 'file:///C:/secret.png', 'C:\\secret.png', 'javascript:alert(1)',
    'data:text/html;base64,AAAA', '%00photo.png', '%zz.png'])('%s をVaultの読込先にしない', source => {
    expect(localImagePath(source, 'Notes/Test.md')).toBeNull();
  });
  it('HTTPSとラスターdata URLのみを外部画像として扱う', () => {
    expect(externalImageSource('https://example.com/img.png')).toBe('https://example.com/img.png');
    expect(externalImageSource('//example.com/img.png')).toBe('https://example.com/img.png');
    expect(externalImageSource('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    for (const url of ['javascript:alert(1)', 'file:///C:/secret.png', 'data:image/svg+xml;base64,AAAA',
      'https://user:password@example.com/img.png', 'http://example.com/img.png']) {
      expect(externalImageSource(url)).toBeNull();
    }
  });
  it('標準画像記法は別フォルダの同名画像に勝手にフォールバックしない', async () => {
    const adapter = new MemoryAdapter('Image resolver');
    await adapter.writeBinary('Elsewhere/photo.png', new Uint8Array([1]).buffer);
    const vault = new VaultService(adapter);
    const resolver = new EmbedResolver({ vault, index: () => null, currentPath: () => null }, () => undefined);
    resolver.setEntries(await vault.listAll());
    expect(await resolver.resolveImage('photo.png', 'Root.md')).toBeNull();
    expect(await resolver.resolveImage('missing/photo.png', 'Note.md')).toBeNull();
    expect(await resolver.resolveImage('/Elsewhere/photo.png', 'Note.md')).toMatch(/^blob:/);
    resolver.dispose();
  });
});
