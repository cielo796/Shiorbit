import type { VaultAdapter } from '../core/vault/VaultAdapter';
import type { VPath } from '../core/vault/types';
import type { KeyValueStore } from '../core/storage/KeyValueStore';
import { VaultService, type VaultEvent } from '../core/vault/VaultService';
import { ConflictError, isVaultError } from '../core/vault/errors';
import { basename, dirname, isHtml, isMarkdown, isSupportedDocument, normalize } from '../core/vault/path';
import { Indexer } from '../core/index/Indexer';
import { Settings } from '../core/settings/Settings';
import { CommandRegistry } from '../core/commands/CommandRegistry';
import { dailyPath } from '../core/notes/date';
import { applyTemplate } from '../core/notes/template';
import { MarkdownEditor } from './editor';
import { Explorer } from './explorer';
import { BacklinksPane } from './backlinksPane';
import { UnresolvedPane } from './unresolvedPane';
import { SearchPane } from './searchPane';
import { TagPane } from './tagPane';
import { QuickSwitcher } from './quickSwitcher';
import { CommandPalette } from './commandPalette';
import { SettingsModal } from './settingsModal';
import { ModalList } from './modalList';
import { LocalGraphPane } from './graph/localGraphPane';
import { GraphModal } from './graph/graphModal';
import { livePreview } from './livePreview';
import { refreshPreview } from './previewState';
import { followLinkCommand, wikilinkExtension, type WikilinkProvider } from './wikilinkExtension';
import { MobileToolbar } from './mobileToolbar';
import { MobileNav, type NavTarget } from './mobileNav';
import { trackKeyboardInset } from './viewport';
import { button, el, noteLabel } from './dom';

/** Vault の入手方法。実装は main.ts (合成ルート) から注入される。 */
export interface VaultSource {
  supported: boolean;
  unsupportedReason: string;
  pick: () => Promise<VaultAdapter>;
  restore: (prompt: boolean) => Promise<VaultAdapter | null>;
  hasSaved: () => Promise<boolean>;
  demo: () => Promise<VaultAdapter>;
}

export interface AppDeps {
  /** インデックスの保存先。無くても動く（毎回全件スキャンになるだけ）。 */
  cache?: KeyValueStore;
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
type Tab = 'files' | 'search' | 'tags' | 'unresolved';

const SAVE_DEBOUNCE_MS = 500;
const POLL_INTERVAL_MS = 5000;

export class App {
  private vault: VaultService | null = null;
  private index: Indexer | null = null;
  private settings: Settings | null = null;
  private readonly commands = new CommandRegistry();

  private editor: MarkdownEditor | null = null;
  private explorer: Explorer | null = null;
  private searchPane: SearchPane | null = null;
  private tagPane: TagPane | null = null;
  private unresolvedPane: UnresolvedPane | null = null;
  private backlinksPane: BacklinksPane | null = null;
  private localGraph: LocalGraphPane | null = null;
  private graphModal: GraphModal | null = null;
  private readonly switcher: QuickSwitcher;
  private readonly palette: CommandPalette;
  private settingsModal: SettingsModal | null = null;
  private mobileNav: MobileNav | null = null;

  private currentPath: VPath | null = null;
  private baseMtime = 0;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private currentTab: Tab = 'files';

  private els: {
    workspace: HTMLElement;
    title: HTMLElement;
    emptyNote: HTMLElement;
    paneHost: HTMLElement;
    tabs: Map<Tab, HTMLButtonElement>;
    statusPath: HTMLElement;
    statusSave: HTMLElement;
    statusIndex: HTMLElement;
  } | null = null;

  private readonly toastHost: HTMLElement;

  /** エディタから見た「いま何が解決できるか」。Indexer を UI の外へ露出させない。 */
  private readonly wikilinks: WikilinkProvider = {
    isResolved: (target) => this.index?.resolve(target, this.currentPath ?? '') != null,
    follow: (target) => void this.followLink(target),
    suggest: () => {
      const items = this.index?.suggestions() ?? [];
      const counts = new Map<string, number>();
      for (const s of items) {
        const key = s.basename.toLowerCase();
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return items.map((s) => ({
        target: (counts.get(s.basename.toLowerCase()) ?? 0) > 1 ? s.path.replace(/\.md$/i, '') : s.basename,
        label: s.basename,
        detail: s.path,
      }));
    },
  };

  constructor(
    private readonly root: HTMLElement,
    private readonly source: VaultSource,
    private readonly deps: AppDeps = {},
  ) {
    this.toastHost = el('div', 'toast-host');
    document.body.append(this.toastHost);

    this.switcher = new QuickSwitcher({
      items: () => this.index?.suggestions() ?? [],
      onOpen: (path) => void this.openNote(path),
      onCreate: (name) => void this.createFromName(name),
    });
    this.palette = new CommandPalette(this.commands);

    window.addEventListener('focus', () => void this.vault?.poll());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        void this.saveNow();
        void this.index?.flush();
      }
    });
    window.addEventListener('beforeunload', (e) => {
      if (this.dirty) {
        void this.saveNow();
        e.preventDefault();
      }
      void this.index?.flush();
    });
    window.addEventListener('keydown', (e) => this.onGlobalKey(e));
    trackKeyboardInset();
  }

  async start(): Promise<void> {
    this.renderWelcome('起動中…');
    try {
      const restored = await this.source.restore(false);
      if (restored) {
        await this.openVault(restored);
        return;
      }
    } catch {
      /* 復元に失敗しても welcome を出せばよい */
    }
    this.renderWelcome();
  }

  // --------------------------------------------------------------- welcome

  private renderWelcome(busy?: string): void {
    this.root.replaceChildren();
    const wrap = el('div', 'welcome');

    const h1 = el('h1');
    h1.append('Shior', Object.assign(document.createElement('span'), { textContent: 'bit' }));
    wrap.append(h1);

    if (busy) {
      wrap.append(el('p', undefined, busy));
      this.root.append(wrap);
      return;
    }

    if (this.source.supported) {
      wrap.append(
        el('p', undefined,
          'フォルダを選ぶと、その中の .md / .html / .htm ファイルをそのまま編集できます。' +
          'ファイルは通常形式のままなので、いつでも他のアプリで開けます。'),
      );
      const row = el('div', 'row');
      row.append(
        button('フォルダを開く', 'primary', async () => {
          try {
            await this.openVault(await this.source.pick());
          } catch (e) {
            if ((e as { name?: string })?.name === 'AbortError') return;
            this.toast(errorMessage(e), true);
          }
        }),
      );
      void this.source.hasSaved().then((has) => {
        if (!has) return;
        row.append(
          button('前回のフォルダを開く', undefined, async () => {
            try {
              const v = await this.source.restore(true);
              if (v) await this.openVault(v);
              else this.toast('アクセスを許可できませんでした。', true);
            } catch (e) {
              this.toast(errorMessage(e), true);
            }
          }),
        );
      });
      wrap.append(row);
    } else {
      wrap.append(el('p', undefined, this.source.unsupportedReason));
      const row = el('div', 'row');
      row.append(button('デモモードで見る', 'primary', async () => {
        await this.openVault(await this.source.demo());
      }));
      wrap.append(row);
    }

    wrap.append(
      el('div', 'note',
        'Phase 2: Live Preview / タグ / Daily Notes / テンプレート / テーマ / ' +
        'コマンドパレット（Ctrl+Shift+P）/ インデックスの差分更新。'),
    );
    this.root.append(wrap);
  }

  // ------------------------------------------------------------- workspace

  private async openVault(adapter: VaultAdapter): Promise<void> {
    this.vault?.dispose();
    this.index?.dispose();
    this.localGraph?.destroy();
    this.graphModal?.close();

    const vault = new VaultService(adapter);
    this.vault = vault;
    this.settings = new Settings(vault);
    this.index = new Indexer(vault, this.deps.cache ? { cache: this.deps.cache } : {});
    this.currentPath = null;
    this.dirty = false;

    await this.settings.load();
    this.applyTheme();
    this.settings.onChange(() => this.applySettings());

    this.settingsModal = new SettingsModal({
      read: () => this.settings!.data,
      save: (patch) => this.settings!.update(patch),
    });

    this.registerCommands();
    this.renderWorkspace();
    await this.refreshTree();

    this.setIndexStatus('インデックス作成中…');
    await this.index.rebuild((done, total) => {
      if (done % 50 === 0 || done === total) this.setIndexStatus(`インデックス作成中… ${done}/${total}`);
    });
    this.index.onChange(() => this.onIndexChanged());
    this.onIndexChanged();

    const report = this.index.report;
    if (report.reused > 0) {
      this.toast(`インデックスを ${report.ms}ms で復元しました（再利用 ${report.reused} / 再読込 ${report.scanned}）。`);
    }

    vault.on((ev) => void this.onVaultEvent(ev));
    vault.startWatching({ intervalMs: POLL_INTERVAL_MS });

    if (!vault.caps.realFolder) {
      this.toast('デモモードです。変更は保存されず、リロードで消えます。', true);
    }
  }

  private registerCommands(): void {
    this.commands.register(
      { id: 'quick-switcher', name: 'ノートを開く（クイックスイッチャ）', hotkey: 'Ctrl+O', run: () => this.switcher.open() },
      { id: 'search', name: '全文検索', hotkey: 'Ctrl+Shift+F', run: () => { this.openSidebar(); this.setTab('search'); } },
      { id: 'new-note', name: '新しいノートを作る', run: () => void this.newNote() },
      { id: 'daily-note', name: '今日のノートを開く', hotkey: 'Ctrl+Shift+D', run: () => void this.openDaily() },
      { id: 'insert-template', name: 'テンプレートを挿入', run: () => this.insertTemplate(), available: () => this.currentPath !== null },
      { id: 'save', name: '保存する', hotkey: 'Ctrl+S', run: () => void this.saveNow() },
      {
        id: 'toggle-live-preview',
        name: 'Live Preview を切り替える',
        run: () => void this.settings?.update({ livePreview: !this.settings.data.livePreview }),
      },
      {
        id: 'toggle-theme',
        name: 'テーマを切り替える（ダーク / ライト）',
        run: () => void this.settings?.update({ theme: this.settings.data.theme === 'dark' ? 'light' : 'dark' }),
      },
      { id: 'graph', name: 'グラフを開く', hotkey: 'Ctrl+G', run: () => this.openGraph() },
      { id: 'settings', name: '設定を開く', run: () => this.settingsModal?.open() },
      { id: 'reindex', name: 'インデックスを作り直す', run: () => void this.reindexAll(true) },
      {
        id: 'delete-note',
        name: 'このノートを削除する',
        available: () => this.currentPath !== null,
        run: () => void this.deleteEntry(this.currentPath!),
      },
    );
  }

  private renderWorkspace(): void {
    const vault = this.vault!;
    const settings = this.settings!;
    this.root.replaceChildren();
    const workspace = el('div', 'workspace');

    // --- 左サイドバー
    const sidebar = el('aside', 'sidebar');
    const head = el('div', 'sidebar-head');
    const vaultName = el('div', 'vault-name', vault.name);
    vaultName.title = vault.name;
    head.append(
      vaultName,
      button('+', 'ghost', () => void this.newNote()),
      button('⚙', 'ghost', () => this.settingsModal?.open()),
    );

    const tabs = el('div', 'sidebar-tabs');
    const tabButtons = new Map<Tab, HTMLButtonElement>();
    const addTab = (id: Tab, label: string, title: string): void => {
      const b = button(label, 'tab', () => this.setTab(id));
      b.title = title;
      tabButtons.set(id, b);
      tabs.append(b);
    };
    addTab('files', 'ファイル', 'ファイルツリー');
    addTab('search', '検索', '全文検索');
    addTab('tags', 'タグ', 'タグ一覧');
    addTab('unresolved', '未解決', '未解決リンク（まだ書いていないノート）');

    const paneHost = el('div', 'pane-host');

    this.explorer = new Explorer({
      onOpen: (p) => void this.openNote(p),
      onDelete: (p) => void this.deleteEntry(p),
    });
    this.searchPane = new SearchPane({
      search: (q) => this.index?.searchNotes(q) ?? Promise.resolve([]),
      onOpen: (p) => void this.openNote(p),
    });
    this.tagPane = new TagPane({ onOpen: (p) => void this.openNote(p) });
    this.unresolvedPane = new UnresolvedPane({
      onCreate: (name) => void this.createFromName(name),
      onOpen: (p, offset) => void this.openNote(p, offset),
    });

    sidebar.append(head, tabs, paneHost);

    // --- 中央
    const main = el('div', 'main');
    const mainHead = el('div', 'main-head');
    const title = el('div', 'main-title', 'ノートを選択してください');
    mainHead.append(
      button('☰', 'ghost menu-btn', () => workspace.classList.toggle('drawer-open')),
      title,
      button('⌕', 'ghost', () => this.switcher.open()),
      button('⋯', 'ghost', () => this.palette.open()),
      button('◍', 'ghost', () => this.openGraph()),
      button('⇄', 'ghost', () => workspace.classList.toggle('rightbar-open')),
    );

    const editorHost = el('div', 'editor-host');
    const emptyNote = el('div', 'empty-note',
      'ツリーからノートを開くか、「+」で作成します（Ctrl+O でも切り替えられます）');
    const editor = new MarkdownEditor({
      onChange: () => this.onEdit(),
      onSave: () => void this.saveNow(),
      showLineNumbers: settings.data.showLineNumbers,
      extensions: [
        livePreview(() => isMarkdown(this.currentPath ?? '') && (this.settings?.data.livePreview ?? false)),
        wikilinkExtension(this.wikilinks, {
          conceal: () => isMarkdown(this.currentPath ?? '') && (this.settings?.data.livePreview ?? false),
        }),
      ],
      extraKeymap: [
        { key: 'Mod-Enter', preventDefault: true, run: followLinkCommand(this.wikilinks) },
      ],
    });
    this.editor = editor;
    editor.dom.style.display = 'none';
    editorHost.append(emptyNote, editor.dom);

    const toolbar = new MobileToolbar({ editor: () => this.editor });
    main.append(mainHead, editorHost, toolbar.dom);

    // --- 右ペイン（ローカルグラフ + バックリンク）
    this.backlinksPane = new BacklinksPane({
      onOpen: (p, offset) => void this.openNote(p, offset),
      onCreate: (name) => void this.createFromName(name),
    });
    this.localGraph = new LocalGraphPane({
      onSelect: (id, kind, label) => void this.onGraphSelect(id, kind, label),
      currentId: () => this.currentPath,
      onExpand: () => this.openGraph(),
    });
    this.graphModal = new GraphModal({
      getInput: () => this.index?.graphInput() ?? [],
      currentId: () => this.currentPath,
      onSelect: (id, kind, label) => void this.onGraphSelect(id, kind, label),
    });
    const rightbar = el('aside', 'rightbar');
    rightbar.append(this.localGraph.dom, this.backlinksPane.dom);

    // --- ステータスバー
    const statusbar = el('div', 'statusbar');
    const statusAdapter = el('span', vault.caps.realFolder ? 'badge' : 'badge demo', vault.id);
    const statusPath = el('span', undefined, '');
    const statusIndex = el('span', 'status-index', '');
    const statusSave = el('span', 'save', '');
    statusbar.append(statusAdapter, statusPath, el('span', 'spacer'), statusIndex, statusSave);

    const scrim = el('div', 'scrim');
    scrim.addEventListener('click', () => {
      workspace.classList.remove('drawer-open', 'rightbar-open');
      scrim.style.display = 'none';
    });
    scrim.style.display = 'none';
    workspace.addEventListener('click', () => {
      const open = workspace.classList.contains('drawer-open') || workspace.classList.contains('rightbar-open');
      scrim.style.display = open ? '' : 'none';
    });

    this.mobileNav = new MobileNav({ onSelect: (target) => this.onMobileNav(target) });

    workspace.append(sidebar, main, rightbar, statusbar, this.mobileNav.dom, scrim);
    this.root.append(workspace);

    this.els = { workspace, title, emptyNote, paneHost, tabs: tabButtons, statusPath, statusSave, statusIndex };
    this.setTab('files');
    this.setSaveState('idle');
  }

  private setTab(tab: Tab): void {
    const els = this.els;
    if (!els) return;
    this.currentTab = tab;
    for (const [id, b] of els.tabs) b.classList.toggle('active', id === tab);

    const pane =
      tab === 'files' ? this.explorer?.dom :
      tab === 'search' ? this.searchPane?.dom :
      tab === 'tags' ? this.tagPane?.dom :
      this.unresolvedPane?.dom;
    if (pane) els.paneHost.replaceChildren(pane);
    if (tab === 'search') this.searchPane?.focus();
  }

  /**
   * ボトムナビ。同じ項目をもう一度押すと閉じてエディタに戻る。
   * 狭い画面では「開く」と同じくらい「閉じる」導線が要る。
   */
  private onMobileNav(target: NavTarget): void {
    const workspace = this.els?.workspace;
    if (!workspace) return;

    if (target === 'graph') {
      workspace.classList.remove('drawer-open');
      this.mobileNav?.setActive(null);
      this.openGraph();
      return;
    }

    const alreadyOpen =
      workspace.classList.contains('drawer-open') && this.currentTab === target;
    if (alreadyOpen) {
      workspace.classList.remove('drawer-open');
      this.mobileNav?.setActive(null);
      return;
    }

    workspace.classList.add('drawer-open');
    this.setTab(target);
    this.mobileNav?.setActive(target);
  }

  private openSidebar(): void {
    this.els?.workspace.classList.add('drawer-open');
  }

  private applyTheme(): void {
    document.documentElement.dataset['theme'] = this.settings?.data.theme ?? 'dark';
  }

  private applySettings(): void {
    this.applyTheme();
    this.editor?.setLineNumbers(this.settings?.data.showLineNumbers ?? true);
    this.editor?.applyEffects([refreshPreview.of(null)]);
    this.localGraph?.refreshTheme();
  }

  private async refreshTree(): Promise<void> {
    if (!this.vault || !this.explorer) return;
    try {
      this.explorer.setEntries(await this.vault.listDocumentTree());
      this.explorer.setActive(this.currentPath);
    } catch (e) {
      this.toast(errorMessage(e), true);
    }
  }

  private async reindexAll(force = false): Promise<void> {
    await this.refreshTree();
    if (!this.index) return;
    this.setIndexStatus('再インデックス中…');
    await this.index.rebuild(undefined, force);
    this.onIndexChanged();
    this.toast(`インデックスを作り直しました（${this.index.report.ms}ms）。`);
  }

  // ----------------------------------------------------------- index 反映

  private onIndexChanged(): void {
    const index = this.index;
    if (!index) return;

    const stats = index.stats();
    this.setIndexStatus(
      `${stats.notes} ノート / ${stats.links} リンク` +
      (stats.unresolved > 0 ? ` / 未解決 ${stats.unresolved}` : ''),
    );

    this.unresolvedPane?.setGroups(index.unresolved());
    this.tagPane?.setTags(index.tags());
    this.searchPane?.refresh();
    this.localGraph?.update(index.graphInput());
    this.graphModal?.refresh();

    if (this.currentPath) {
      this.backlinksPane?.setNote(this.currentPath, index.backlinks(this.currentPath), index.outgoing(this.currentPath));
    } else {
      this.backlinksPane?.setNote(null, [], []);
    }

    this.editor?.applyEffects([refreshPreview.of(null)]);
  }

  // ---------------------------------------------------------------- notes

  private async openNote(path: VPath, offset?: number): Promise<void> {
    if (!this.vault || !this.editor || !this.els) return;
    if (!isSupportedDocument(path)) {
      this.toast(`${path} は未対応のファイル形式です。`, true);
      return;
    }
    if (this.dirty) await this.saveNow();

    try {
      const note = await this.vault.readNote(path);
      this.currentPath = path;
      this.baseMtime = note.mtime;
      this.dirty = false;
      this.editor.setLanguage(isHtml(path) ? 'html' : 'markdown');
      this.editor.setDoc(note.text);
      this.editor.dom.style.display = '';
      this.els.emptyNote.style.display = 'none';
      this.els.title.textContent = path;
      this.els.statusPath.textContent = path;
      this.explorer?.setActive(path);
      this.setSaveState('idle');
      this.els.workspace.classList.remove('drawer-open');
      this.mobileNav?.setActive(null);
      this.onIndexChanged();
      if (offset !== undefined) this.editor.revealOffset(offset);
      else this.editor.focus();
    } catch (e) {
      this.toast(errorMessage(e), true);
    }
  }

  private openGraph(): void {
    this.graphModal?.open();
  }

  /** グラフのノードをクリックしたとき。未解決ノードはその場で作れる。 */
  private async onGraphSelect(
    id: string,
    kind: 'note' | 'unresolved',
    label: string,
  ): Promise<void> {
    if (kind === 'unresolved') await this.createFromName(label);
    else await this.openNote(id);
  }

  private async followLink(target: string): Promise<void> {
    const resolved = this.index?.resolve(target, this.currentPath ?? '') ?? null;
    if (resolved) await this.openNote(resolved);
    else await this.createFromName(target);
  }

  /**
   * 名前からノートを作る。
   * フォルダ指定が無ければ、いま開いているノートと同じフォルダに置く
   * （リンク解決が「近いものを優先」なので、関連ノートが自然にまとまる）。
   */
  private async createFromName(name: string, body?: string): Promise<void> {
    const vault = this.vault;
    if (!vault) return;

    const trimmed = name.trim().replace(/\.md$/i, '');
    if (trimmed === '') return;

    const dir = this.currentPath ? dirname(this.currentPath) : '';
    const base = trimmed.includes('/') || dir === '' ? trimmed : `${dir}/${trimmed}`;
    const path = `${normalize(base)}.md`;

    try {
      if (await vault.exists(path)) {
        await this.openNote(path);
        return;
      }
      const heading = basename(path, true);
      await vault.createNote(path, body ?? `# ${heading}\n\n`);
      await this.refreshTree();
      await this.index?.updateNote(path);
      await this.openNote(path);
      this.toast(`${path} を作成しました。`);
    } catch (e) {
      this.toast(errorMessage(e), true);
    }
  }

  /** 今日の Daily Note。無ければテンプレートから作る。 */
  private async openDaily(): Promise<void> {
    const vault = this.vault;
    const settings = this.settings;
    if (!vault || !settings) return;

    const { dailyFolder, dailyFormat, dailyTemplate } = settings.data;
    const path = dailyPath(new Date(), dailyFolder, dailyFormat);

    try {
      if (await vault.exists(path)) {
        await this.openNote(path);
        return;
      }

      const title = basename(path, true);
      let body = `# ${title}\n\n`;
      if (dailyTemplate.trim() !== '') {
        try {
          body = applyTemplate((await vault.readNote(dailyTemplate)).text, { title });
        } catch {
          this.toast(`テンプレート ${dailyTemplate} が読めませんでした。既定の内容で作ります。`, true);
        }
      }

      await vault.createNote(path, body);
      await this.refreshTree();
      await this.index?.updateNote(path);
      await this.openNote(path);
    } catch (e) {
      this.toast(errorMessage(e), true);
    }
  }

  /** テンプレートフォルダの中身を選んでカーソル位置に挿入する */
  private insertTemplate(): void {
    const vault = this.vault;
    const settings = this.settings;
    if (!vault || !settings || !this.editor || !this.currentPath) return;

    const folder = settings.data.templateFolder.trim();
    void (async () => {
      let files: VPath[] = [];
      try {
        files = (await vault.listNotes())
          .map((e) => e.path)
          .filter((p) => folder === '' || p === folder || p.startsWith(`${folder}/`));
      } catch {
        files = [];
      }

      if (files.length === 0) {
        this.toast(`テンプレートが見つかりません（${folder || 'ルート'} に .md を置いてください）。`, true);
        return;
      }

      new ModalList({
        placeholder: 'テンプレートを選ぶ',
        items: (query) =>
          files
            .filter((p) => query === '' || p.toLowerCase().includes(query.toLowerCase()))
            .map((p) => ({ id: p, title: noteLabel(p), subtitle: p })),
        onSelect: (item) => {
          void (async () => {
            try {
              const text = (await vault.readNote(item.id)).text;
              this.editor?.insertAtCursor(applyTemplate(text, { title: basename(this.currentPath!, true) }));
            } catch (e) {
              this.toast(errorMessage(e), true);
            }
          })();
        },
      }).open();
    })();
  }

  private onEdit(): void {
    this.dirty = true;
    this.setSaveState('dirty');
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.saveNow(), SAVE_DEBOUNCE_MS);
  }

  private async saveNow(): Promise<void> {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const vault = this.vault;
    const path = this.currentPath;
    if (!vault || !path || !this.editor || !this.dirty) return;

    const text = this.editor.getDoc();
    this.setSaveState('saving');
    try {
      this.baseMtime = await vault.writeNote(path, text, this.baseMtime);
      this.dirty = false;
      this.setSaveState('saved');
      await this.index?.updateNote(path);
    } catch (e) {
      if (e instanceof ConflictError) await this.resolveConflict(path, text);
      else {
        this.setSaveState('error');
        this.toast(errorMessage(e), true);
      }
    }
  }

  /**
   * 競合の解決 (設計書 §9)。
   * どちらを選んでも、失われる側は必ず .conflict-*.md として残す。
   */
  private async resolveConflict(path: VPath, mine: string): Promise<void> {
    const vault = this.vault;
    if (!vault || !this.editor) return;

    const keepMine = window.confirm(
      `「${path}」は他の場所で変更されています。\n\n` +
        `［OK］自分の変更を保存する（外部の内容を .conflict ファイルに退避）\n` +
        `［キャンセル］外部の内容を読み込む（自分の変更を .conflict ファイルに退避）`,
    );

    try {
      if (keepMine) {
        const external = await vault.readNote(path);
        const backup = await vault.saveConflictCopy(path, external.text);
        this.baseMtime = await vault.overwriteNote(path, mine);
        this.dirty = false;
        this.setSaveState('saved');
        this.toast(`保存しました。外部の内容は ${backup} に退避しています。`);
      } else {
        const backup = await vault.saveConflictCopy(path, mine);
        const fresh = await vault.readNote(path);
        this.editor.setDoc(fresh.text);
        this.baseMtime = fresh.mtime;
        this.dirty = false;
        this.setSaveState('saved');
        this.toast(`外部の内容を読み込みました。自分の変更は ${backup} に退避しています。`);
      }
      await this.refreshTree();
      await this.index?.updateNote(path);
    } catch (e) {
      this.setSaveState('error');
      this.toast(errorMessage(e), true);
    }
  }

  private async newNote(): Promise<void> {
    const input = window.prompt('新しいノートの名前（フォルダ付きも可: AI/Ollama）', '無題');
    if (input === null) return;
    await this.createFromName(input);
  }

  private async deleteEntry(path: VPath): Promise<void> {
    const vault = this.vault;
    if (!vault) return;
    if (!window.confirm(`「${path}」を削除します。よろしいですか？`)) return;
    try {
      await vault.remove(path);
      this.index?.removeNote(path);
      if (this.currentPath === path) this.closeNote();
      await this.refreshTree();
      this.toast(`${path} を削除しました。`);
    } catch (e) {
      this.toast(errorMessage(e), true);
    }
  }

  private closeNote(): void {
    if (!this.els || !this.editor) return;
    this.currentPath = null;
    this.dirty = false;
    this.editor.setDoc('');
    this.editor.dom.style.display = 'none';
    this.els.emptyNote.style.display = '';
    this.els.title.textContent = 'ノートを選択してください';
    this.els.statusPath.textContent = '';
    this.backlinksPane?.setNote(null, [], []);
    this.setSaveState('idle');
  }

  // --------------------------------------------------------------- events

  private onGlobalKey(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || !this.vault) return;
    const key = e.key.toLowerCase();

    if (e.shiftKey && key === 'p') {
      e.preventDefault();
      this.palette.open();
      return;
    }
    if (e.shiftKey && key === 'f') {
      e.preventDefault();
      void this.commands.run('search');
      return;
    }
    if (e.shiftKey && key === 'd') {
      e.preventDefault();
      void this.commands.run('daily-note');
      return;
    }
    if (!e.shiftKey && key === 'g') {
      e.preventDefault();
      this.openGraph();
      return;
    }
    if (!e.shiftKey && (key === 'o' || key === 'p')) {
      e.preventDefault();
      this.switcher.open();
    }
  }

  private async onVaultEvent(ev: VaultEvent): Promise<void> {
    if (ev.type === 'error') {
      if (isVaultError(ev.error, 'EPERM')) {
        this.toast('フォルダへのアクセス権が切れました。開き直してください。', true);
      }
      return;
    }
    if (ev.type === 'refresh') return;

    if (ev.type === 'modify') {
      if (ev.path === this.currentPath) {
        if (!this.dirty) {
          const fresh = await this.vault!.readNote(ev.path);
          this.editor?.setDoc(fresh.text);
          this.baseMtime = fresh.mtime;
          this.toast('外部の変更を読み込みました。');
        } else {
          this.toast('このノートは外部でも変更されています。保存時に確認します。', true);
        }
      }
      if (isSupportedDocument(ev.path)) await this.index?.updateNote(ev.path);
      return;
    }
    if (ev.type === 'create') {
      await this.refreshTree();
      if (isSupportedDocument(ev.path)) await this.index?.updateNote(ev.path);
      return;
    }
    if (ev.type === 'delete') {
      if (isSupportedDocument(ev.path)) this.index?.removeNote(ev.path);
      await this.refreshTree();
      return;
    }
    if (ev.type === 'rename') {
      this.index?.removeNote(ev.from);
      await this.index?.updateNote(ev.to);
      await this.refreshTree();
    }
  }

  // --------------------------------------------------------------- status

  private setSaveState(state: SaveState): void {
    if (!this.els) return;
    const label: Record<SaveState, string> = {
      idle: '', dirty: '未保存', saving: '保存中…', saved: '保存済み', error: '保存に失敗',
    };
    const cls: Record<SaveState, string> = {
      idle: 'save', dirty: 'save', saving: 'save saving', saved: 'save saved', error: 'save error',
    };
    this.els.statusSave.textContent = label[state];
    this.els.statusSave.className = cls[state];
  }

  private setIndexStatus(text: string): void {
    if (this.els) this.els.statusIndex.textContent = text;
  }

  private toast(message: string, isError = false): void {
    const node = el('div', isError ? 'toast error' : 'toast', message);
    this.toastHost.append(node);
    setTimeout(() => node.remove(), 6000);
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
