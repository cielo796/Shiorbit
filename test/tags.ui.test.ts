// @vitest-environment jsdom
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { App, type VaultSource } from '../src/ui/app';
import { MemoryAdapter } from '../src/adapters/memory';
import { SettingsModal } from '../src/ui/settingsModal';
import { DEFAULT_SETTINGS, SETTINGS_PATH } from '../src/core/settings/Settings';
import { openTagEditor } from '../src/ui/tagEditor';

beforeAll(() => {
  Object.assign(Range.prototype, {
    getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    getClientRects: () => Object.assign([], { item: () => null }),
  });
  Element.prototype.scrollIntoView = () => undefined;
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(() => { document.body.replaceChildren(); });

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
function click(host: ParentNode, label: string): void {
  const target = [...host.querySelectorAll('button')].find((b) => b.textContent === label);
  expect(target, label).toBeDefined();
  target!.click();
}
async function start(adapter: MemoryAdapter): Promise<HTMLElement> {
  const root = document.createElement('div');
  document.body.append(root);
  const source: VaultSource = {
    supported: false, unsupportedReason: '', pick: async () => adapter,
    restore: async () => adapter, hasSaved: async () => true, demo: async () => adapter,
  };
  await new App(root, source).start();
  return root;
}
function tags(root: HTMLElement): string[] {
  return [...root.querySelectorAll('.tag-name')].map((node) => node.textContent!);
}
function toggle(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('.settings-modal input[aria-label="タグの自動収集"]')!;
}

describe('タグ設定と専用UI', () => {
  it('設定画面でその場で切替、取消、保存でき、再起動時にもOFFになる', async () => {
    const adapter = new MemoryAdapter('tags-ui');
    const body = '---\ntags: [手動]\n---\n#自動\n';
    await adapter.write('note.md', body);
    const root = await start(adapter);
    click(root, 'タグ');
    expect(tags(root)).toEqual(expect.arrayContaining(['#手動', '#自動']));
    click(root, '⚙');
    expect(toggle().checked).toBe(true);
    toggle().click();
    expect(tags(root)).toEqual(['#手動']);
    expect(await adapter.exists(SETTINGS_PATH)).toBe(false);
    click(document.querySelector('.settings-modal')!, '閉じる');
    expect(tags(root)).toContain('#自動');
    click(root, '⚙');
    toggle().click();
    click(document.querySelector('.settings-modal')!, '保存');
    await vi.waitFor(() => expect(document.querySelector('.settings-modal')).toBeNull());
    expect(JSON.parse(await adapter.read(SETTINGS_PATH)).autoCollectTags).toBe(false);
    expect(await adapter.read('note.md')).toBe(body);
    const restored = await start(adapter);
    click(restored, 'タグ');
    expect(tags(restored)).toEqual(['#手動']);
    click(restored, '⚙');
    expect(toggle().checked).toBe(false);
    click(document.querySelector('.settings-modal')!, '閉じる');
  });

  it('自動収集OFFでも専用UIから手動タグを編集・保存できる', async () => {
    const adapter = new MemoryAdapter('tag-editor-ui');
    await adapter.write(SETTINGS_PATH, JSON.stringify({ autoCollectTags: false }));
    await adapter.write('note.md', '---\ntags: [古い]\n---\n#自動\n本文\n');
    const root = await start(adapter);
    root.querySelector<HTMLElement>('.tree .row')!.click();
    for (let i = 0; i < 8; i++) await tick();
    click(root, 'タグ');
    click(root, 'ノートのタグを編集');
    let modal = document.querySelector('.tag-editor')!;
    const existing = modal.querySelector<HTMLInputElement>('input[aria-label="タグ 1"]')!;
    existing.value = '変更';
    existing.dispatchEvent(new Event('input'));
    const input = modal.querySelector<HTMLInputElement>('input[aria-label="追加するタグ"]')!;
    input.value = '新規';
    click(modal, '追加');
    click(modal, '適用');
    await vi.waitFor(async () => {
      expect(await adapter.read('note.md')).toBe('---\ntags: ["変更", "新規"]\n---\n#自動\n本文\n');
    }, { timeout: 2000 });
    expect(tags(root)).toEqual(expect.arrayContaining(['#変更', '#新規']));
    expect(tags(root)).not.toContain('#自動');
    click(root, 'ノートのタグを編集');
    modal = document.querySelector('.tag-editor')!;
    click(modal, '削除');
    click(modal, 'キャンセル');
    expect(await adapter.read('note.md')).toContain('"変更"');
  });

  it('文書なし・HTMLでは手動タグの編集を無効にする', async () => {
    const adapter = new MemoryAdapter('html-tags-ui');
    await adapter.write('a.html', '<p>HTML</p>');
    const root = await start(adapter);
    click(root, 'タグ');
    expect(root.querySelector<HTMLButtonElement>('.tag-edit-current')!.disabled).toBe(true);
    click(root, 'ファイル');
    root.querySelector<HTMLElement>('.tree .row')!.click();
    for (let i = 0; i < 8; i++) await tick();
    click(root, 'タグ');
    expect(root.querySelector<HTMLButtonElement>('.tag-edit-current')!.disabled).toBe(true);
  });

  it('保存失敗を画面に出し、閉じるとプレビューを破棄できる', async () => {
    const discard = vi.fn();
    const modal = new SettingsModal({
      read: () => DEFAULT_SETTINGS, discardPreview: discard,
      save: async () => { throw new Error('書き込み不可'); },
    });
    modal.open();
    toggle().click();
    click(document.querySelector('.settings-modal')!, '保存');
    await vi.waitFor(() => expect(document.querySelector('.settings-modal')!.textContent).toContain('書き込み不可'));
    click(document.querySelector('.settings-modal')!, '閉じる');
    expect(discard).toHaveBeenCalledOnce();
  });

  it('タグの不正な入力や同時変更のエラーでは適用せず画面を残す', () => {
    const apply = vi.fn(() => { throw new Error('ノートが変わりました'); });
    openTagEditor({ path: 'note.md', text: '#本文', autoCollectTags: true, suggestions: [], apply });
    const modal = document.querySelector('.tag-editor')!;
    const input = modal.querySelector<HTMLInputElement>('input[aria-label="追加するタグ"]')!;
    input.value = '空 白';
    click(modal, '適用');
    expect(apply).not.toHaveBeenCalled();
    expect(modal.textContent).toContain('空白やカンマ');
    input.value = '有効';
    click(modal, '適用');
    expect(apply).toHaveBeenCalledOnce();
    expect(modal.textContent).toContain('ノートが変わりました');
    click(modal, 'キャンセル');
  });
});
