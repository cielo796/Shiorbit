// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../src/ui/app';
import { MemoryAdapter } from '../src/adapters/memory';
import { DEFAULT_SETTINGS, SETTINGS_PATH, normalize } from '../src/core/settings/Settings';
import { LAYOUT_PATH } from '../src/core/settings/workspaceLayout';
import { SettingsModal } from '../src/ui/settingsModal';

beforeAll(() => {
  Object.assign(Range.prototype, {
    getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    getClientRects: () => Object.assign([], { item: () => null }),
  });
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(() => document.body.replaceChildren());

async function start(adapter: MemoryAdapter): Promise<HTMLElement> {
  const root = document.createElement('div');
  document.body.append(root);
  await new App(root, {
    supported: false, unsupportedReason: '', restore: async () => adapter,
    hasSaved: async () => true, pick: async () => adapter, demo: async () => adapter,
  }).start();
  return root;
}

describe('起動時の復元設定', () => {
  it('既存設定は従来どおり復元し、文字列等をboolean扱いしない', () => {
    expect(normalize({}).restoreTabsOnStartup).toBe(true);
    expect(normalize({}).restoreFoldersOnStartup).toBe(true);
    expect(normalize({ restoreTabsOnStartup: false, restoreFoldersOnStartup: false })).toMatchObject({
      restoreTabsOnStartup: false, restoreFoldersOnStartup: false,
    });
    expect(normalize({ restoreTabsOnStartup: 'false', restoreFoldersOnStartup: 0 })).toMatchObject({
      restoreTabsOnStartup: true, restoreFoldersOnStartup: true,
    });
  });

  it.each([[true, true], [true, false], [false, true], [false, false]])(
    'タブ=%s・フォルダ=%s は独立して復元する', async (restoreTabsOnStartup, restoreFoldersOnStartup) => {
      const adapter = new MemoryAdapter('Startup settings');
      await adapter.write('A/Child/One.md', '# One');
      await adapter.write('Other/Two.html', '<h1>Two</h1>');
      await adapter.mkdir('New');
      await adapter.write(SETTINGS_PATH, JSON.stringify({ restoreTabsOnStartup, restoreFoldersOnStartup }));
      await adapter.write(LAYOUT_PATH, JSON.stringify({
        panes: [
          { tabs: ['A/Child/One.md'], active: 'A/Child/One.md' },
          { tabs: ['Other/Two.html'], active: 'Other/Two.html' },
        ],
        activePane: 1, sidebarShown: true, rightbarShown: false, sidebarWidth: 310,
        expandedFolders: ['A', 'A/Child'],
      }));
      const root = await start(adapter);
      expect(root.querySelectorAll('.tab-item')).toHaveLength(restoreTabsOnStartup ? 2 : 0);
      expect(root.querySelectorAll('.document-pane')).toHaveLength(restoreTabsOnStartup ? 2 : 1);
      if (restoreTabsOnStartup) expect(root.querySelector('.main-title')?.textContent).toBe('Other/Two.html');
      for (const path of ['A', 'A/Child']) {
        expect(root.querySelector(`.row[data-path="${path}"]`)?.getAttribute('aria-expanded')).toBe(String(restoreFoldersOnStartup));
      }
      expect(root.querySelector('.row[data-path="New"]')?.getAttribute('aria-expanded')).toBe('false');
      expect(root.querySelector('.row[data-path="Other"]')?.getAttribute('aria-expanded')).toBe('false');
      // 表示を閉じて開始しても、実ファイルや本文は削除・変更しない。
      expect(await adapter.read('A/Child/One.md')).toBe('# One');
      expect(await adapter.read('Other/Two.html')).toBe('<h1>Two</h1>');
    },
  );

  it('設定画面の2つのトグルは保存でき、閉じるだけなら取り消す', async () => {
    const save = vi.fn(async () => undefined);
    const preview = vi.fn();
    const discard = vi.fn();
    const modal = new SettingsModal({ read: () => DEFAULT_SETTINGS, save, preview, discardPreview: discard });
    const toggle = (label: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    const click = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.settings-modal button')]
      .find(button => button.textContent === label)!.click();
    modal.open();
    toggle('前回のタブを復元').click();
    toggle('フォルダの開閉状態を復元').click();
    expect(preview).toHaveBeenLastCalledWith({ restoreTabsOnStartup: false, restoreFoldersOnStartup: false });
    click('閉じる');
    expect(save).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledOnce();
    modal.open();
    expect(toggle('前回のタブを復元').checked).toBe(true);
    toggle('前回のタブを復元').click();
    click('保存');
    await vi.waitFor(() => expect(document.querySelector('.settings-modal')).toBeNull());
    expect(save).toHaveBeenCalledWith({ restoreTabsOnStartup: false });
  });
});
