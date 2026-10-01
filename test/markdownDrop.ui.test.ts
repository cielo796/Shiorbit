// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../src/ui/app';
import { captureDroppedMarkdown } from '../src/adapters/droppedMarkdown';
import { MemoryAdapter } from '../src/adapters/memory';
import { MarkdownImportController } from '../src/ui/markdownImportController';
import { VaultService } from '../src/core/vault/VaultService';

beforeAll(() => {
  Object.assign(Range.prototype, {
    getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    getClientRects: () => Object.assign([], { item: () => null }),
  });
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(() => document.body.replaceChildren());
const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };

function drop(target: Element, files: Array<{ name: string; text: string }>): Event {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: {
    types: ['Files'], items: [], dropEffect: 'none',
    files: files.map((file) => ({ name: file.name, arrayBuffer: async () => new TextEncoder().encode(file.text).buffer })),
  } });
  target.dispatchEvent(event);
  return event;
}

function paste(target: Element, files: Array<{ name: string; text: string }>): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: {
    types: ['Files'], items: [],
    files: files.map((file) => ({ name: file.name, arrayBuffer: async () => new TextEncoder().encode(file.text).buffer })),
  } });
  target.dispatchEvent(event);
  return event;
}
async function setup() {
  const adapter = new MemoryAdapter('Drop UI');
  await adapter.write('Other/Current.md', '# 現在のノート');
  await adapter.mkdir('Parent/Notes');
  await adapter.write('Parent/Notes/Existing.md', '# 既存');
  const root = document.createElement('div');
  document.body.append(root);
  await new App(root, {
    supported: false, unsupportedReason: '', restore: async () => adapter,
    hasSaved: async () => true, pick: async () => adapter, demo: async () => adapter,
  }, { captureDroppedMarkdown }).start();
  root.querySelector<HTMLElement>('.row[data-path="Other/Current.md"]')!.click();
  await settle();
  return { adapter, root };
}

describe('アプリのMarkdownドロップ取り込み', () => {
  it('ExplorerでコピーしたMDとHTMLを、選択したフォルダへCtrl+Vで取り込む', async () => {
    const { root, adapter } = await setup();
    const folder = root.querySelector<HTMLElement>('.row[data-path="Parent/Notes"]')!;
    folder.click();
    expect(folder.classList.contains('paste-target')).toBe(true);

    const event = paste(folder, [
      { name: 'Copied.md', text: '# コピーしたノート' },
      { name: 'Copied.html', text: '<h1>コピーしたHTML</h1>' },
    ]);
    expect(event.defaultPrevented).toBe(true);
    await settle();

    expect(await adapter.read('Parent/Notes/Copied.md')).toBe('# コピーしたノート');
    expect(await adapter.read('Parent/Notes/Copied.html')).toBe('<h1>コピーしたHTML</h1>');
    expect(root.querySelector('.main-title')?.textContent).toBe('Parent/Notes/Copied.html');
    expect(root.querySelector<HTMLElement>('.row[data-path="Parent/Notes/Copied.html"]')?.classList.contains('paste-target')).toBe(true);
    expect(root.querySelector<HTMLElement>('.row[data-path="Parent/Notes/Copied.html"]')?.classList.contains('active')).toBe(true);
    expect([...root.querySelectorAll('.tab-item')].map(tab => tab.getAttribute('title'))).toEqual([
      'Other/Current.md', 'Parent/Notes/Copied.md', 'Parent/Notes/Copied.html',
    ]);
  });

  it('同名を上書きしない場合は保存できたファイルだけを開く', async () => {
    const { root, adapter } = await setup();
    const folder = root.querySelector<HTMLElement>('.row[data-path="Parent/Notes"]')!;
    folder.click();
    paste(folder, [
      { name: 'Existing.md', text: '上書きしない' },
      { name: 'New.md', text: '# 貼り付け後に開く' },
    ]);
    await settle();
    const confirm = document.querySelector('.confirm-dialog')!;
    [...confirm.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '上書きしない')!.click();
    await settle();
    expect(await adapter.read('Parent/Notes/Existing.md')).toBe('# 既存');
    expect(root.querySelector('.main-title')?.textContent).toBe('Parent/Notes/New.md');
    expect(root.querySelector('.cm-content')?.textContent).toContain('貼り付け後に開く');
    expect([...root.querySelectorAll('.tab-item')].some(tab => tab.textContent?.includes('Existing'))).toBe(false);
  });

  it('すべてスキップした貼り付けでは編集中のノートを維持する', async () => {
    const { root } = await setup();
    const folder = root.querySelector<HTMLElement>('.row[data-path="Parent/Notes"]')!;
    folder.click();
    paste(folder, [{ name: 'Existing.md', text: '変更しない' }]);
    await settle();
    const confirm = document.querySelector('.confirm-dialog')!;
    [...confirm.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '上書きしない')!.click();
    await settle();
    expect(root.querySelector('.main-title')?.textContent).toBe('Other/Current.md');
  });

  it('文字列だけの貼り付けは取り込み処理で横取りしない', async () => {
    const { root } = await setup();
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: {
      types: ['text/plain'], items: [], files: [], getData: () => '通常の文字列',
    } });
    root.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(document.querySelector('.import-result-dialog')).toBeNull();
  });

  it.each([
    ['.row[data-path="Parent/Notes"]', 'Parent/Notes/Import.md'],
    ['.row[data-path="Parent/Notes/Existing.md"]', 'Parent/Notes/Import.md'],
    ['.sidebar-head', 'Import.md'],
    ['.explorer-pane .sidebar-body', 'Import.md'],
  ])('%s にドロップすると %s へ保存し、編集中のノートは切り替えない', async (selector, destination) => {
    const { root, adapter } = await setup();
    const editor = root.querySelector('.cm-content');
    root.querySelector<HTMLElement>('.row[data-path="Parent/Notes"]')!.click();
    expect(drop(root.querySelector(selector)!, [{ name: 'Import.md', text: '\ufeff# 日本語\r\n#取り込み' }]).defaultPrevented).toBe(true);
    await settle();
    expect(await adapter.read(destination)).toBe('\ufeff# 日本語\r\n#取り込み');
    expect(await adapter.exists('Other/Import.md')).toBe(false);
    expect(root.querySelector('.main-title')?.textContent).toBe('Other/Current.md');
    expect(root.querySelector('.cm-content')).toBe(editor);
    expect(await adapter.read('Other/Current.md')).toBe('# 現在のノート');
    const imported = root.querySelector<HTMLElement>(`.row[data-path="${destination}"]`);
    expect(imported).not.toBeNull();
    imported!.click();
    await settle();
    expect(root.querySelector('.main-title')?.textContent).toBe(destination);
    expect(root.querySelector('.cm-content')?.textContent).toContain('日本語');
    // 索引にも取り込まれているため、タグ集計から探せる。
    [...root.querySelectorAll<HTMLButtonElement>('.sidebar-tabs .tab')].find((el) => el.textContent === 'タグ')!.click();
    expect(root.textContent).toContain('取り込み');
  });

  it('HTMLも保存し、同名ファイルは確認で拒否すると既存内容を維持する', async () => {
    const { root, adapter } = await setup();
    await adapter.write('Parent/Notes/Taken.md', '既存');
    drop(root.querySelector('.row[data-path="Parent/Notes"]')!, [
      { name: 'Taken.md', text: '上書きしない' },
      { name: 'page.html', text: '<html></html>' },
      { name: 'Good.md', text: '# 新規' },
    ]);
    await settle();
    const confirm = document.querySelector('.confirm-dialog')!;
    expect(confirm.textContent).toContain('Taken.md');
    expect(document.activeElement?.textContent).toBe('上書きしない');
    [...confirm.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '上書きしない')!.click();
    await settle();
    expect(await adapter.read('Parent/Notes/Taken.md')).toBe('既存');
    expect(await adapter.read('Parent/Notes/page.html')).toBe('<html></html>');
    expect(await adapter.read('Parent/Notes/Good.md')).toBe('# 新規');
    const report = document.querySelector('.import-result-dialog')!;
    expect(report.textContent).toContain('2件取り込み、1件スキップ、0件失敗');
    expect(report.textContent).toContain('Taken.md');
  });

  it('同名ファイルは確認で許可した場合だけ上書きする', async () => {
    const { root, adapter } = await setup();
    await adapter.write('Parent/Notes/Taken.md', '既存');
    drop(root.querySelector('.row[data-path="Parent/Notes/Existing.md"]')!, [
      { name: 'Taken.md', text: '上書き後' },
    ]);
    await settle();
    const confirm = document.querySelector('.confirm-dialog')!;
    [...confirm.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '上書きする')!.click();
    await settle();
    expect(await adapter.read('Parent/Notes/Taken.md')).toBe('上書き後');
  });

  it('エディタ上へのドロップは取り込まず、通常のページ遷移を止める', async () => {
    const { root, adapter } = await setup();
    expect(drop(root.querySelector('.main-title')!, [{ name: 'Ignore.md', text: '# A' }]).defaultPrevented).toBe(true);
    await settle();
    expect(await adapter.exists('Ignore.md')).toBe(false);
    expect(await adapter.read('Other/Current.md')).toBe('# 現在のノート');
  });

  it('読み込み中にVaultを解除しても新旧どちらのフォルダにも保存しない', async () => {
    const adapter = new MemoryAdapter('Old');
    let vault: VaultService | null = new VaultService(adapter);
    const reveal = vi.fn();
    const controller = new MarkdownImportController({
      vault: () => vault, index: () => null, refreshTree: async () => undefined, reveal, toast: vi.fn(),
      capture: async () => [{ name: 'a.md', kind: 'file', readText: async () => { vault = null; return '# A'; } }],
    });
    await controller.drop('', {} as DataTransfer);
    expect(await adapter.exists('a.md')).toBe(false);
    expect(reveal).not.toHaveBeenCalled();
  });
});
