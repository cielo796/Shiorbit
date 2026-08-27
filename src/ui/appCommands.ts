import type { CommandRegistry } from '../core/commands/CommandRegistry';

export interface AppCommandActions {
  openQuickSwitcher: () => void;
  openSearch: () => void;
  openTrash: () => void;
  createNote: () => void | Promise<void>;
  openDaily: () => void | Promise<void>;
  insertTemplate: () => void;
  save: () => void | Promise<void>;
  toggleLivePreview: () => void | Promise<void>;
  toggleTheme: () => void | Promise<void>;
  openGraph: () => void;
  closeTab: () => void | Promise<void>;
  closeTabsLeft: () => void | Promise<void>;
  closeTabsRight: () => void | Promise<void>;
  closeOtherTabs: () => void | Promise<void>;
  nextTab: () => void | Promise<void>;
  previousTab: () => void | Promise<void>;
  toggleSplit: () => void;
  focusOtherPane: () => void;
  openInOtherPane: () => void | Promise<void>;
  openSettings: () => void;
  zoomIn: () => void | Promise<void>;
  zoomOut: () => void | Promise<void>;
  zoomReset: () => void | Promise<void>;
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
    { id: 'trash', name: 'ごみ箱を開く', run: actions.openTrash },
    { id: 'new-note', name: '新しいノートを作る', run: actions.createNote },
    { id: 'daily-note', name: '今日のノートを開く', hotkey: 'Ctrl+Shift+D', run: actions.openDaily },
    { id: 'insert-template', name: 'テンプレートを挿入', run: actions.insertTemplate, available: actions.hasCurrentNote },
    { id: 'save', name: '保存する', hotkey: 'Ctrl+S', run: actions.save },
    { id: 'toggle-live-preview', name: 'Live Preview を切り替える', run: actions.toggleLivePreview },
    { id: 'toggle-theme', name: 'テーマを切り替える（ダーク / ライト）', run: actions.toggleTheme },
    { id: 'graph', name: 'グラフを開く', hotkey: 'Ctrl+G', run: actions.openGraph },
    { id: 'close-tab', name: 'タブを閉じる', hotkey: 'Ctrl+W', run: actions.closeTab, available: actions.hasCurrentNote },
    {
      id: 'close-tabs-left',
      name: '左側のタブを閉じる',
      available: actions.hasCurrentNote,
      run: actions.closeTabsLeft,
    },
    {
      id: 'close-tabs-right',
      name: '右側のタブを閉じる',
      available: actions.hasCurrentNote,
      run: actions.closeTabsRight,
    },
    {
      id: 'close-other-tabs',
      name: '他のタブを閉じる',
      available: actions.hasCurrentNote,
      run: actions.closeOtherTabs,
    },
    { id: 'next-tab', name: '次のタブ', hotkey: 'Ctrl+Tab', run: actions.nextTab },
    { id: 'previous-tab', name: '前のタブ', hotkey: 'Ctrl+Shift+Tab', run: actions.previousTab },
    { id: 'toggle-split', name: '画面を分割する / 戻す', hotkey: 'Ctrl+\\', run: actions.toggleSplit },
    { id: 'focus-other-pane', name: 'もう片方のペインへ移る', run: actions.focusOtherPane },
    {
      id: 'open-in-other-pane',
      name: 'このノートを隣のペインで開く',
      available: actions.hasCurrentNote,
      run: actions.openInOtherPane,
    },
    { id: 'settings', name: '設定を開く', run: actions.openSettings },
    { id: 'zoom-in', name: '表示を拡大する', hotkey: 'Ctrl++', run: actions.zoomIn },
    { id: 'zoom-out', name: '表示を縮小する', hotkey: 'Ctrl+-', run: actions.zoomOut },
    { id: 'zoom-reset', name: '表示倍率を等倍に戻す', hotkey: 'Ctrl+0', run: actions.zoomReset },
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
