import { MobileNav, type NavTarget } from './mobileNav';
import { button, el } from './dom';

export type WorkspaceTab = 'files' | 'search' | 'tags' | 'unresolved' | 'trash';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const SAVE_LABEL: Record<SaveState, string> = {
  idle: '', dirty: '未保存', saving: '保存中…', saved: '保存済み', error: '保存に失敗',
};
const SAVE_CLASS: Record<SaveState, string> = {
  idle: 'save', dirty: 'save', saving: 'save saving', saved: 'save saved', error: 'save error',
};

export interface WorkspaceChromeOptions {
  vaultName: string;
  vaultId: string;
  /** デモ Vault は見分けが付くようにしるしを変える */
  realFolder: boolean;
  onTab: (tab: WorkspaceTab) => void;
  onNew: () => void;
  onSettings: () => void;
  onQuickSwitcher: () => void;
  onPalette: () => void;
  onGraph: () => void;
  onMobileNav: (target: NavTarget) => void;
  onToggleSidebar: () => void;
  onToggleRightbar: () => void;
}

/**
 * 幅によって「畳む」と「かぶせて出す」が入れ替わる境目。
 *
 * **style.css のメディアクエリと同じ値**。片方だけ変えると、
 * 押しても何も起きないボタンができる。
 */
const SIDEBAR_IS_DRAWER = '(max-width: 767px)';
const RIGHTBAR_IS_OVERLAY = '(max-width: 1099px)';

function matches(query: string): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

/** App が状態を流し込む先。DOM の組み立てはこのファイルに閉じる。 */
export interface WorkspaceChrome {
  workspace: HTMLElement;
  sidebar: HTMLElement;
  paneHost: HTMLElement;
  tabs: Map<WorkspaceTab, HTMLButtonElement>;
  main: HTMLElement;
  /** View が申告する表示切り替えボタンの置き場 */
  modes: HTMLElement;
  title: HTMLElement;
  statusbar: HTMLElement;
  scrim: HTMLElement;
  mobileNav: MobileNav;

  /** ステータスバーへの書き込みは、要素を持っているこちら側に置く。 */
  setPath: (path: string | null) => void;
  setSaveState: (state: SaveState) => void;
  setIndexStatus: (text: string) => void;
  /** サイドバーに出すペインを差し替える。 */
  showPane: (pane: HTMLElement | undefined) => void;
  setActiveTab: (tab: WorkspaceTab) => void;
  /** 狭い画面のサイドバー（引き出し）の開閉。 */
  setDrawerOpen: (open: boolean) => void;
  isDrawerOpen: () => boolean;

  /**
   * 左右のパネルの表示。
   * 広い画面では桁ごと畳み、狭い画面ではかぶせて出す（見た目は違うが、
   * 呼び出し側から見れば「出す / しまう」の1つの状態）。
   */
  setSidebarShown: (shown: boolean) => void;
  isSidebarShown: () => boolean;
  setRightbarShown: (shown: boolean) => void;
  isRightbarShown: () => boolean;
}

const TABS: Array<{ id: WorkspaceTab; label: string; title: string }> = [
  { id: 'files', label: 'ファイル', title: 'ファイルツリー' },
  { id: 'search', label: '検索', title: '全文検索' },
  { id: 'tags', label: 'タグ', title: 'タグ一覧' },
  { id: 'unresolved', label: '未解決', title: '未解決リンク（まだ書いていないノート）' },
  { id: 'trash', label: 'ごみ箱', title: '削除したノートと、競合で退避したファイル' },
];

/**
 * ワークスペースの外枠（設計書 §8）。
 *
 * 中身（ペイン・ドキュメント領域）は App が差し込む。
 * ここは「どこに何を置くか」だけを持ち、状態は持たない。
 */
export function buildWorkspaceChrome(opts: WorkspaceChromeOptions): WorkspaceChrome {
  const workspace = el('div', 'workspace');

  // --- 左サイドバー
  const sidebar = el('aside', 'sidebar');
  const head = el('div', 'sidebar-head');
  const vaultName = el('div', 'vault-name', opts.vaultName);
  vaultName.title = opts.vaultName;
  head.append(
    vaultName,
    button('+', 'ghost', opts.onNew),
    button('⚙', 'ghost', opts.onSettings),
  );

  const tabs = el('div', 'sidebar-tabs');
  const tabButtons = new Map<WorkspaceTab, HTMLButtonElement>();
  for (const tab of TABS) {
    const tabButton = button(tab.label, 'tab', () => opts.onTab(tab.id));
    tabButton.title = tab.title;
    tabButtons.set(tab.id, tabButton);
    tabs.append(tabButton);
  }

  const paneHost = el('div', 'pane-host');
  sidebar.append(head, tabs, paneHost);

  // --- 中央
  const main = el('div', 'main');
  const mainHead = el('div', 'main-head');
  const title = el('div', 'main-title', 'ノートを選択してください');
  const modes = el('div', 'html-view-modes');
  modes.style.display = 'none';
  mainHead.append(
    button('☰', 'ghost menu-btn', opts.onToggleSidebar),
    title,
    modes,
    button('⌕', 'ghost', opts.onQuickSwitcher),
    button('⋯', 'ghost', opts.onPalette),
    button('◍', 'ghost', opts.onGraph),
    button('⇄', 'ghost', opts.onToggleRightbar),
  );
  main.append(mainHead);

  // --- ステータスバー
  const statusbar = el('div', 'statusbar');
  const statusPath = el('span', undefined, '');
  const statusIndex = el('span', 'status-index', '');
  const statusSave = el('span', 'save', '');
  statusbar.append(
    el('span', opts.realFolder ? 'badge' : 'badge demo', opts.vaultId),
    statusPath,
    el('span', 'spacer'),
    statusIndex,
    statusSave,
  );

  // --- 狭い画面用の覆い
  const scrim = el('div', 'scrim');
  scrim.style.display = 'none';
  scrim.addEventListener('click', () => {
    workspace.classList.remove('drawer-open', 'rightbar-open');
    scrim.style.display = 'none';
  });
  workspace.addEventListener('click', () => {
    const open =
      workspace.classList.contains('drawer-open') || workspace.classList.contains('rightbar-open');
    scrim.style.display = open ? '' : 'none';
  });

  const mobileNav = new MobileNav({ onSelect: opts.onMobileNav });

  return {
    workspace,
    sidebar,
    paneHost,
    tabs: tabButtons,
    main,
    modes,
    title,
    statusbar,
    scrim,
    mobileNav,

    setPath: (path) => {
      title.textContent = path ?? 'ノートを選択してください';
      statusPath.textContent = path ?? '';
    },
    setSaveState: (state) => {
      statusSave.textContent = SAVE_LABEL[state];
      statusSave.className = SAVE_CLASS[state];
    },
    setIndexStatus: (text) => {
      statusIndex.textContent = text;
    },
    showPane: (pane) => {
      if (pane) paneHost.replaceChildren(pane);
    },
    setActiveTab: (tab) => {
      for (const [id, tabButton] of tabButtons) tabButton.classList.toggle('active', id === tab);
    },
    setDrawerOpen: (open) => workspace.classList.toggle('drawer-open', open),
    isDrawerOpen: () => workspace.classList.contains('drawer-open'),

    setSidebarShown: (shown) => {
      if (matches(SIDEBAR_IS_DRAWER)) workspace.classList.toggle('drawer-open', shown);
      else workspace.classList.toggle('sidebar-hidden', !shown);
    },
    isSidebarShown: () =>
      matches(SIDEBAR_IS_DRAWER)
        ? workspace.classList.contains('drawer-open')
        : !workspace.classList.contains('sidebar-hidden'),

    setRightbarShown: (shown) => {
      if (matches(RIGHTBAR_IS_OVERLAY)) workspace.classList.toggle('rightbar-open', shown);
      else workspace.classList.toggle('rightbar-hidden', !shown);
    },
    isRightbarShown: () =>
      matches(RIGHTBAR_IS_OVERLAY)
        ? workspace.classList.contains('rightbar-open')
        : !workspace.classList.contains('rightbar-hidden'),
  };
}
