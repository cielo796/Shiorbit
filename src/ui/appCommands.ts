import type { CommandRegistry } from '../core/commands/CommandRegistry';

export interface AppCommandActions {
  openQuickSwitcher: () => void;
  openSearch: () => void;
  createNote: () => void | Promise<void>;
  openDaily: () => void | Promise<void>;
  insertTemplate: () => void;
  save: () => void | Promise<void>;
  toggleLivePreview: () => void | Promise<void>;
  toggleTheme: () => void | Promise<void>;
  openGraph: () => void;
  openSettings: () => void;
  reindex: () => void | Promise<void>;
  renameCurrentNote: () => void | Promise<void>;
  deleteCurrentNote: () => void | Promise<void>;
  hasCurrentNote: () => boolean;
}

/** App が提供するコマンド定義を、画面のライフサイクルから分離して登録する。 */
export function registerAppCommands(
  registry: CommandRegistry,
  actions: AppCommandActions,
): void {
  registry.register(
    { id: 'quick-switcher', name: 'ノートを開く（クイックスイッチャ）', hotkey: 'Ctrl+O', run: actions.openQuickSwitcher },
    { id: 'search', name: '全文検索', hotkey: 'Ctrl+Shift+F', run: actions.openSearch },
    { id: 'new-note', name: '新しいノートを作る', run: actions.createNote },
    { id: 'daily-note', name: '今日のノートを開く', hotkey: 'Ctrl+Shift+D', run: actions.openDaily },
    { id: 'insert-template', name: 'テンプレートを挿入', run: actions.insertTemplate, available: actions.hasCurrentNote },
    { id: 'save', name: '保存する', hotkey: 'Ctrl+S', run: actions.save },
    { id: 'toggle-live-preview', name: 'Live Preview を切り替える', run: actions.toggleLivePreview },
    { id: 'toggle-theme', name: 'テーマを切り替える（ダーク / ライト）', run: actions.toggleTheme },
    { id: 'graph', name: 'グラフを開く', hotkey: 'Ctrl+G', run: actions.openGraph },
    { id: 'settings', name: '設定を開く', run: actions.openSettings },
    { id: 'reindex', name: 'インデックスを作り直す', run: actions.reindex },
    {
      id: 'rename-note',
      name: 'このノートの名前を変更する',
      available: actions.hasCurrentNote,
      run: actions.renameCurrentNote,
    },
    {
      id: 'delete-note',
      name: 'このノートを削除する',
      available: actions.hasCurrentNote,
      run: actions.deleteCurrentNote,
    },
  );
}
