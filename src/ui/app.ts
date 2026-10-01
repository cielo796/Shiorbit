import type { VaultAdapter } from '../core/vault/VaultAdapter';
import type { VPath } from '../core/vault/types';
import type { KeyValueStore } from '../core/storage/KeyValueStore';
import { VaultService } from '../core/vault/VaultService';
import {
  basename, dirname, extname, isMarkdown, isSupportedDocument, join, relative,
} from '../core/vault/path';
import { Indexer } from '../core/index/Indexer';
import { LIMITS, Settings } from '../core/settings/Settings';
import {
  LAYOUT_PATH, isEmptyLayout, normalizeLayout, parseLayout, serializeLayout,
} from '../core/settings/workspaceLayout';
import { CommandRegistry } from '../core/commands/CommandRegistry';
import { MarkdownEditor } from './editor';
import { QuickSwitcher } from './quickSwitcher';
import { CommandPalette } from './commandPalette';
import { SettingsModal } from './settingsModal';
import { openTagEditor } from './tagEditor';
import { GraphModal } from './graph/graphModal';
import { RightPane } from './rightPane';
import { registerAppCommands } from './appCommands';
import { RenameController } from './renameController';
import { DocumentCreator } from './documentCreator';
import { MarkdownImportController, type CaptureDroppedMarkdown } from './markdownImportController';
import { CleanupController } from './cleanupController';
import { SidebarPanes } from './sidebarPanes';
import { Shortcuts } from './shortcuts';
import { VaultSync } from './vaultSync';
import { livePreview } from './livePreview';
import { refreshPreview } from './previewState';
import { followLinkCommand, wikilinkExtension, type WikilinkProvider } from './wikilinkExtension';
import { MobileToolbar } from './mobileToolbar';
import type { MobileNav, NavTarget } from './mobileNav';
import { buildWorkspaceChrome, type WorkspaceChrome } from './workspaceChrome';
import { renderWelcome } from './welcomeScreen';
import { trackKeyboardInset } from './viewport';
import { button, el } from './dom';
import { applyAppearance } from './appearance';
import { Toaster } from './toaster';
import { createHtmlPreviewFrame } from './htmlPreview';
import { confirmDialog } from './dialog';
import { BasesView } from './basesView';
import type { DocumentArea } from './documentArea';
import { DocumentPane } from './documentPane';
import { WorkspacePanes, type OpenTarget } from './workspacePanes';
import type { DocumentMode, DocumentSurfaces } from './views/DocumentView';
import { CanvasView } from './canvas/CanvasView';
import { EmbedResolver } from './embed/embedResolver';
import { SearchHistory } from '../core/search/SearchHistory';
import { enumerateMatches } from './search/searchState';
import type { SearchSession } from './search/SearchPanel';
import { isEmbeddableImage } from './embed/attachmentUrl';
import { pickImageFile, type PickImageFile } from './imagePicker';

/** Vault の入手方法。実装は main.ts (合成ルート) から注入される。 */
export interface VaultSource {
  supported: boolean;
  unsupportedReason: string;
  pick: () => Promise<VaultAdapter>;
  restore: (prompt: boolean) => Promise<VaultAdapter | null>;
  hasSaved: () => Promise<boolean>;
  /** 次回起動用に記憶したフォルダ設定だけを消去する。 */
  forget?: () => Promise<void>;
  demo: () => Promise<VaultAdapter>;
}

export interface AppDeps {
  /** インデックスの保存先。無くても動く（毎回全件スキャンになるだけ）。 */
  cache?: KeyValueStore;
  captureDroppedMarkdown?: CaptureDroppedMarkdown;
  /** テストではファイル選択UIを出さず、選択結果だけを差し込める。 */
  pickImageFile?: PickImageFile;
}

type Tab = 'files' | 'search' | 'tags' | 'unresolved' | 'trash';


export class App {
  private readonly markdownImporter: MarkdownImportController | null;
  private vault: VaultService | null = null;
  private index: Indexer | null = null;
  private settings: Settings | null = null;
  private searchHistory: SearchHistory = new SearchHistory();
  private readonly searchSession: SearchSession = { replaceExpanded: false };
  private readonly commands = new CommandRegistry();

  private panes: SidebarPanes | null = null;
  private rightPane: RightPane | null = null;
  private graphModal: GraphModal | null = null;
  private readonly switcher: QuickSwitcher;
  private readonly palette: CommandPalette;
  private readonly renamer: RenameController;
  private readonly creator: DocumentCreator;
  private readonly cleanup: CleanupController;
  private readonly shortcuts: Shortcuts;
  private readonly sync: VaultSync;
  private settingsModal: SettingsModal | null = null;
  private mobileNav: MobileNav | null = null;
  private mobileToolbar: MobileToolbar | null = null;

  /** ペイン一式。分割していなければ1つ。 */
  private workspacePanes: WorkspacePanes | null = null;
  private currentTab: Tab = 'files';
  /** startWatching をやり直すのは間隔が変わったときだけにする。 */
  private watchInterval = 0;
  private layoutTimer: ReturnType<typeof setTimeout> | null = null;
  private layoutWrites: Promise<void> = Promise.resolve();
  private pendingLayoutWrites = 0;
  /** ![[...]] と Canvas の file ノードの中身。ObjectURL の解放もここが持つ。 */
  private embeds: EmbedResolver | null = null;

  private chrome: WorkspaceChrome | null = null;

  private readonly toaster = new Toaster();

  /** いま開いている文書。開いていなければ null。 */
  private get currentPath(): VPath | null {
    return this.workspacePanes?.path ?? null;
  }



  /** いま操作しているペインのドキュメント領域。 */
  private get area(): DocumentArea | null {
    return this.workspacePanes?.active.area ?? null;
  }

  private get editor(): MarkdownEditor | null {
    return this.area?.surfaces.editor ?? null;
  }


  /** エディタから見た「いま何が解決できるか」。Indexer を UI の外へ露出させない。 */
  private readonly wikilinks: WikilinkProvider = {
    isResolved: (target) => this.index?.resolve(target, this.currentPath ?? '') != null,
    follow: (target, aside) => void this.followLink(target, aside),
    embeds: {
      resolve: (target, subpath) => this.embeds?.resolve(target, subpath) ?? Promise.resolve(null),
      open: (target) => void this.followLink(target),
    },
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
    document.body.append(this.toaster.dom);
    this.markdownImporter = deps.captureDroppedMarkdown ? new MarkdownImportController({
      vault: () => this.vault,
      index: () => this.index,
      capture: deps.captureDroppedMarkdown,
      refreshTree: () => this.refreshTree(),
      reveal: (path) => { this.setTab('files'); this.panes?.revealImported(path); },
      openImported: async (path) => {
        await this.openDocument(path);
        this.setTab('files');
        this.panes?.revealCreated(path);
      },
      toast: (message, isError) => this.toast(message, isError),
    }) : null;
    this.root.addEventListener('paste', (event) => this.onPasteFiles(event));

    this.switcher = new QuickSwitcher({
      items: () => this.index?.suggestions() ?? [],
      onOpen: (path) => void this.openDocument(path),
      onCreate: (name) => void this.creator.fromName(name),
    });
    this.palette = new CommandPalette(this.commands);
    this.renamer = new RenameController({
      vault: () => this.vault,
      index: () => this.index,
      currentPath: () => this.currentPath,
      ensureSaved: async () => {
        if ((this.area?.isDirty ?? false)) await this.area?.saveNow();
        return !(this.area?.isDirty ?? false);
      },
      refreshTree: () => this.refreshTree(),
      openNote: (path) => this.openDocument(path),
      notify: (message, isError) => this.toast(message, isError),
    });

    this.shortcuts = new Shortcuts({
      active: () => this.vault !== null,
      settings: () => this.settings,
      commands: this.commands,
      openPalette: () => this.palette.open(),
      openQuickSwitcher: () => this.switcher.open(),
      openGraph: () => this.openGraph(),
      toast: (message) => this.toast(message),
    });

    this.sync = new VaultSync({
      index: () => this.index,
      refreshTree: () => this.refreshTree(),
      applyExternal: (path) => this.area?.applyExternalChange(path) ?? Promise.resolve(),
      toast: (message, isError) => this.toast(message, isError),
    });

    this.cleanup = new CleanupController({
      vault: () => this.vault,
      index: () => this.index,
      pane: () => this.panes?.cleanup ?? null,
      refreshTree: () => this.refreshTree(),
      reindexAll: () => this.reindexAll(),
      forget: (path) => this.area?.forget(path),
      toast: (message, isError) => this.toast(message, isError),
    });

    this.creator = new DocumentCreator({
      vault: () => this.vault,
      index: () => this.index,
      settings: () => this.settings?.data ?? null,
      editor: () => this.editor,
      currentPath: () => this.currentPath,
      refreshTree: () => this.refreshTree(),
      open: (path) => this.openDocument(path),
      onCreated: (path) => { this.setTab('files'); this.panes?.revealCreated(path); },
      toast: (message, isError) => this.toast(message, isError),
    });

    registerAppCommands(this.commands, {
      openQuickSwitcher: () => this.switcher.open(),
      openSearch: () => { this.openSidebar(); this.setTab('search'); },
      openTrash: () => { this.openSidebar(); this.setTab('trash'); },
      createNote: () => this.creator.fromDialog(),
      openDaily: () => this.creator.openDaily(),
      insertTemplate: () => this.creator.insertTemplate(),
      save: () => this.area?.saveNow(),
      toggleLivePreview: () => this.settings?.update({ livePreview: !this.settings.data.livePreview }),
      toggleTheme: () => this.settings?.update({ theme: this.settings.data.theme === 'dark' ? 'light' : 'dark' }),
      openGraph: () => this.openGraph(),
      closeTab: () => this.workspacePanes?.active.close(),
      closeTabsLeft: () => this.closeTabsBeside('left'),
      closeTabsRight: () => this.closeTabsBeside('right'),
      closeOtherTabs: () => this.closeTabsBeside('both'),
      nextTab: () => this.workspacePanes?.active.cycle(1),
      previousTab: () => this.workspacePanes?.active.cycle(-1),
      toggleSplit: () => this.workspacePanes?.toggleSplit(),
      toggleSidebar: () => this.togglePanel('sidebar'),
      toggleRightbar: () => this.togglePanel('rightbar'),
      focusOtherPane: () => this.workspacePanes?.focusOther(),
      openInOtherPane: () => {
        const path = this.currentPath;
        if (path !== null) void this.openDocument(path, undefined, 'other');
      },
      openSettings: () => this.settingsModal?.open(),
      zoomIn: () => this.shortcuts.zoomBy(LIMITS.zoom.step),
      zoomOut: () => this.shortcuts.zoomBy(-LIMITS.zoom.step),
      zoomReset: () => this.shortcuts.zoomBy(0),
      reindex: () => this.reindexAll(true),
      renameCurrentNote: () => this.currentPath ? this.renamer.rename(this.currentPath) : undefined,
      deleteCurrentNote: () => this.currentPath ? this.cleanup.moveToTrash(this.currentPath) : undefined,
      hasCurrentNote: () => this.currentPath !== null,
    });

    window.addEventListener('focus', () => {
      if (document.visibilityState !== 'hidden') void this.vault?.poll();
    });
    document.addEventListener('visibilitychange', () => {
      const hidden = document.visibilityState === 'hidden';
      this.vault?.setWatchingPaused(hidden);
      if (hidden) {
        void this.workspacePanes?.saveAll();
        void this.index?.flush();
      } else {
        void this.vault?.poll();
      }
    });
    window.addEventListener('beforeunload', (e) => {
      if (this.layoutTimer !== null || this.pendingLayoutWrites > 0) {
        e.preventDefault();
        void this.saveLayout().then(() => window.close());
      }
      if ((this.area?.isDirty ?? false)) {
        void this.area?.saveNow();
        e.preventDefault();
      }
      void this.index?.flush();
    });
    window.addEventListener('keydown', (e) => this.shortcuts.onKeyDown(e));
    window.addEventListener('wheel', (e) => this.shortcuts.onWheel(e), { passive: false });
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
    this.root.append(renderWelcome({
      supported: this.source.supported,
      unsupportedReason: this.source.unsupportedReason,
      pick: () => this.source.pick(),
      restore: (prompt) => this.source.restore(prompt),
      hasSaved: () => this.source.hasSaved(),
      demo: () => this.source.demo(),
      onOpen: (adapter) => this.openVault(adapter),
      toast: (message, isError) => this.toast(message, isError),
    }, busy));
  }

  // ------------------------------------------------------------- workspace

  private async openVault(adapter: VaultAdapter): Promise<void> {
    this.chrome?.destroy();
    this.editor?.destroy();
    this.vault?.dispose();
    this.index?.dispose();
    this.rightPane?.destroy();
    this.graphModal?.close();

    const vault = new VaultService(adapter);
    this.vault = vault;
    this.embeds?.dispose();
    this.embeds = new EmbedResolver(
      { vault, index: () => this.index, currentPath: () => this.currentPath },
      (target) => void this.followLink(target),
    );
    this.settings = new Settings(vault);
    this.index = new Indexer(vault, this.deps.cache ? { cache: this.deps.cache } : {});
    await this.settings.load();
    this.searchHistory = new SearchHistory(vault, () => this.toast('検索履歴を保存できませんでした。', true));
    await this.searchHistory.load();
    this.index.setAutoCollectTags(this.settings.data.autoCollectTags);
    applyAppearance(this.settings.data);
    this.settings.onChange(() => this.applySettings());

    this.settingsModal = new SettingsModal({
      read: () => this.settings!.data,
      save: (patch) => this.settings!.update(patch),
      preview: (patch) => this.settings!.preview(patch),
      discardPreview: () => this.settings!.discardPreview(),
      changeVault: this.source.supported ? () => this.changeVault() : undefined,
      forgetVault: this.source.forget ? () => this.forgetVault() : undefined,
    });

    this.renderWorkspace();
    // ツリー・索引・監視開始で同じ一覧を共有し、起動時の全走査は一度だけ。
    const initialEntries = await vault.listAll(true);
    this.panes?.setEntries(initialEntries, this.currentPath);
    this.embeds?.setEntries(initialEntries);

    this.chrome?.setIndexStatus('インデックス作成中…');
    await this.index.rebuild((done, total) => {
      if (done % 50 === 0 || done === total) this.chrome?.setIndexStatus(`インデックス作成中… ${done}/${total}`);
    }, false, initialEntries);
    this.index.onChange(() => this.onIndexChanged());
    this.onIndexChanged();

    const report = this.index.report;
    if (report.reused > 0) {
      this.toast(`インデックスを ${report.ms}ms で復元しました（再利用 ${report.reused} / 再読込 ${report.scanned}）。`);
    }

    // 索引ができてから開き直す。リンクの色分けが最初から正しく出るように。
    await this.restoreLayout();

    vault.on((ev) => void this.sync.handle(ev));
    this.watchInterval = this.settings.data.pollInterval;
    vault.startWatching({ intervalMs: this.watchInterval, initialEntries });
    vault.setWatchingPaused(document.visibilityState === 'hidden');

    if (!vault.caps.realFolder) {
      this.toast('デモモードです。変更は保存されず、リロードで消えます。', true);
    }
  }

  /** 現在の編集を保存してから、別のフォルダへ安全に切り替える。 */
  private async changeVault(): Promise<void> {
    try {
      // ブラウザではユーザー操作中に picker を呼ぶ必要があるため、先に Promise を作る。
      const picked = this.source.pick();
      const adapter = await picked;
      if ((this.area?.isDirty ?? false)) await this.area?.saveNow();
      if ((this.area?.isDirty ?? false)) {
        this.toast('未保存の変更があるため、フォルダを切り替えませんでした。', true);
        return;
      }
      this.settingsModal?.close();
      await this.openVault(adapter);
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return;
      this.toast(errorMessage(e), true);
    }
  }

  /** 記憶したパスだけを解除し、実ファイルには触れず welcome へ戻る。 */
  private async forgetVault(): Promise<void> {
    if (!this.source.forget) return;
    const confirmed = await confirmDialog({
      title: 'フォルダ設定の解除',
      message: '保存したフォルダ設定を解除しますか？\n\nノートやフォルダ自体は削除されません。',
      confirmLabel: '解除する',
    });
    if (!confirmed) return;

    if ((this.area?.isDirty ?? false)) await this.area?.saveNow();
    if ((this.area?.isDirty ?? false)) {
      this.toast('未保存の変更があるため、設定を解除しませんでした。', true);
      return;
    }

    try {
      await this.source.forget();
      this.leaveVault();
      this.toast('フォルダ設定を解除しました。ノートやフォルダは削除されていません。');
    } catch (e) {
      this.toast(errorMessage(e), true);
    }
  }

  private leaveVault(): void {
    this.chrome?.destroy();
    this.settingsModal?.close();
    this.graphModal?.close();
    this.rightPane?.destroy();
    this.workspacePanes?.destroy();
    this.index?.dispose();
    this.vault?.dispose();

    this.settingsModal = null;
    this.graphModal = null;
    this.rightPane = null;
    this.workspacePanes = null;
    this.panes = null;
    this.mobileNav = null;
    this.mobileToolbar = null;
    this.chrome = null;
    this.settings = null;
    this.index = null;
    this.vault = null;
    this.embeds?.dispose();
    this.embeds = null;
    this.renderWelcome();
  }

  private renderWorkspace(): void {
    const vault = this.vault!;
    const settings = this.settings!;
    this.root.replaceChildren();

    const chrome = buildWorkspaceChrome({
      vaultName: vault.name,
      vaultId: vault.id,
      realFolder: vault.caps.realFolder,
      onTab: (tab) => this.setTab(tab),
      // Vault 名の横の＋は、現在のノートによらず Vault 直下に作る。
      onNew: () => void this.creator.fromDialog(''),
      onDropFiles: this.markdownImporter ? (dir, transfer) => void this.markdownImporter!.drop(dir, transfer) : undefined,
      onSettings: () => this.settingsModal?.open(),
      onQuickSwitcher: () => this.switcher.open(),
      onPalette: () => this.palette.open(),
      onGraph: () => this.openGraph(),
      onMobileNav: (target) => this.onMobileNav(target),
      onToggleSidebar: () => this.togglePanel('sidebar'),
      onSidebarResize: () => this.scheduleLayoutSave(),
      onToggleRightbar: () => this.togglePanel('rightbar'),
    });
    this.mobileNav = chrome.mobileNav;

    this.buildPanes();
    this.workspacePanes = new WorkspacePanes({
      createPane: (onFocus, onTabsChanged) =>
        this.buildPane(vault, settings.data.showLineNumbers, chrome.modes, onFocus, onTabsChanged),
      onChanged: () => this.onPanesChanged(),
    });

    const toolbar = new MobileToolbar({ editor: () => this.editor });
    this.mobileToolbar = toolbar;
    chrome.main.append(this.workspacePanes.dom, toolbar.dom);

    this.rightPane = new RightPane({
      onOpen: (path, offset) => void this.openDocument(path, offset),
      onCreate: (name) => void this.creator.fromName(name),
      onReveal: (offset) => this.area?.reveal(offset),
      onGraphSelect: (id, kind, label) => void this.onGraphSelect(id, kind, label),
      currentPath: () => this.currentPath,
      onExpandGraph: () => this.openGraph(),
    });
    this.graphModal = new GraphModal({
      getInput: () => this.index?.graphInput() ?? [],
      currentId: () => this.currentPath,
      onSelect: (id, kind, label) => void this.onGraphSelect(id, kind, label),
    });

    chrome.workspace.append(
      chrome.sidebar,
      chrome.main,
      this.rightPane.dom,
      chrome.statusbar,
      chrome.mobileNav.dom,
      chrome.scrim,
    );
    this.root.append(chrome.workspace);

    this.chrome = chrome;
    this.setTab('files');
    this.chrome?.setSaveState('idle');
  }

  /** 左サイドバーに差し込む各ペイン。 */
  private buildPanes(): void {
    this.panes = new SidebarPanes({
      index: () => this.index,
      onFolderStateChanged: () => void this.saveLayout(),
      open: (path, offset) => void this.openDocument(path, offset),
      create: (name) => void this.creator.fromName(name),
      createIn: (dir, kind) => void this.creator.fromDialog(dir, kind),
      dropFiles: this.markdownImporter ? (dir, transfer) => void this.markdownImporter!.drop(dir, transfer) : undefined,
      moveFile: (from, dir) => void this.renamer.move(from, dir),
      rename: (path) => void this.renamer.rename(path),
      editTags: () => this.editTags(),
      moveToTrash: (path) => void this.cleanup.moveToTrash(path),
      restore: (entry) => void this.cleanup.restore(entry),
      purge: (entry) => void this.cleanup.purge(entry),
      removeConflicts: (paths) => void this.cleanup.removeConflicts(paths),
    });
  }

  /**
   * Windows Explorer などでコピーした MD / HTML を、選択中のフォルダへ取り込む。
   * ファイルを含まない通常のテキスト貼り付けは CodeMirror にそのまま任せる。
   */
  private onPasteFiles(event: ClipboardEvent): void {
    const transfer = event.clipboardData;
    const panes = this.panes;
    if (!transfer || !panes || !this.markdownImporter || !hasClipboardFiles(transfer)) return;
    event.preventDefault();
    event.stopPropagation();
    void this.markdownImporter.paste(panes.pasteDestination(), transfer);
  }

  /**
   * ペインを1つ作る。面（CodeMirror など）はペインごとに1組。
   * CodeMirror は1つの状態を複数 View で共有できないので、
   * 2つのノートを並べるには面も2組要る。
   */
  private buildPane(
    vault: VaultService,
    showLineNumbers: boolean,
    modes: HTMLElement,
    onFocus: () => void,
    onTabsChanged: () => void,
  ): DocumentPane {
    let self: DocumentPane | null = null;
    const isActive = (): boolean => self !== null && this.workspacePanes?.active === self;
    const isLivePreview = (): boolean =>
      isMarkdown(self?.path ?? '') && (this.settings?.data.livePreview ?? false);
    const wikilinks: WikilinkProvider = {
      ...this.wikilinks,
      isResolved: (target) => this.index?.resolve(target, self?.path ?? '') != null,
      embeds: {
        context: () => self?.path ?? '',
        resolve: (target, subpath) => this.embeds?.resolve(target, subpath, self?.path ?? '') ?? Promise.resolve(null),
        open: (target) => void this.followLink(target),
      },
    };

    const surfaces: DocumentSurfaces = {
      editor: new MarkdownEditor({
        searchOptions: {
          history: this.searchHistory,
          session: this.searchSession,
          path: () => self?.path ?? null,
          searchAll: (query, cancelled) => {
            const drafts = new Map<VPath, string>();
            for (const pane of this.workspacePanes?.all ?? []) {
              if (pane.path && isSupportedDocument(pane.path)) drafts.set(pane.path, pane.area.documentText ?? '');
            }
            return this.index?.searchMatches(query.search, (text) => enumerateMatches(query, text), { cancelled, drafts })
              ?? Promise.resolve({ documents: [], total: 0, skipped: 0 });
          },
          openResult: async (path, match, query) => {
            await this.openDocument(path, match.from);
            if (this.currentPath !== path) throw new Error('文書を開けませんでした');
            this.area?.setMode('source');
            this.editor?.revealSearchMatch(query, match);
          },
        },
        onChange: () => self?.area.markDirty(),
        onSave: () => void self?.area.saveNow(),
        onPositionChange: (offset) => {
          if (isActive()) this.rightPane?.setCurrentOffset(offset);
        },
        showLineNumbers,
        onPickImage: () => this.addImageToNote(self?.path ?? null),
        notify: (message, isError) => this.toast(message, isError),
        extensions: [
          livePreview(isLivePreview, {
            context: () => self?.path ?? '',
            resolve: (target, context) => this.embeds?.resolveImage(target, context) ?? Promise.resolve(null),
          }),
          wikilinkExtension(wikilinks, { conceal: isLivePreview }),
        ],
        extraKeymap: [
          { key: 'Mod-Enter', preventDefault: true, run: followLinkCommand(wikilinks) },
        ],
      }),
      preview: createHtmlPreviewFrame(),
      bases: new BasesView({ onOpen: (path) => void this.openDocument(path) }),
      canvas: new CanvasView({
        onOpenFile: (file) => void this.followLink(file),
        loadFile: (file, subpath) => this.embeds?.readSection(file, subpath, 600) ?? Promise.resolve(null),
      }),
    };

    self = new DocumentPane({
      vault,
      index: () => this.index,
      settings: () => this.settings!.data,
      surfaces,
      placeholder: el('div', 'empty-note',
        'ツリーからノートを開くか、「+」で作成します（Ctrl+O でも切り替えられます）'),
      onSaveState: (state) => {
        if (isActive()) this.chrome?.setSaveState(state);
        self?.refreshTabs();
      },
      onChanged: () => {
        if (isActive()) this.onDocumentChanged();
      },
      onModesChanged: (list, active) => {
        if (isActive()) this.renderModes(modes, list, active);
      },
      toast: (message, isError) => this.toast(message, isError),
      onFocus,
      onTabsChanged,
    });
    return self;
  }

  private setTab(tab: Tab): void {
    const chrome = this.chrome;
    if (!chrome) return;
    this.currentTab = tab;
    chrome.setActiveTab(tab);
    chrome.showPane(this.panes?.domFor(tab));
    this.panes?.focus(tab);
    if (tab === 'trash') void this.cleanup.refresh();
  }

  /**
   * ボトムナビ。同じ項目をもう一度押すと閉じてエディタに戻る。
   * 狭い画面では「開く」と同じくらい「閉じる」導線が要る。
   */
  private onMobileNav(target: NavTarget): void {
    const chrome = this.chrome;
    if (!chrome) return;

    // 同じ項目をもう一度押したら閉じる。グラフは引き出しを使わない。
    const close = target === 'graph' || (chrome.isDrawerOpen() && this.currentTab === target);
    chrome.setDrawerOpen(!close);
    this.mobileNav?.setActive(close ? null : target);
    if (target === 'graph') this.openGraph();
    else if (!close) this.setTab(target);
  }

  private openSidebar(): void {
    this.chrome?.setDrawerOpen(true);
  }

  private editTags(): void {
    const area = this.area;
    const path = area?.path;
    if (!area || !path || !isMarkdown(path)) return;
    const editor = area.surfaces.editor;
    const text = editor.getDoc();
    const vault = this.vault;
    openTagEditor({
      path, text,
      autoCollectTags: this.settings?.data.autoCollectTags ?? true,
      suggestions: [...(this.index?.tags().keys() ?? [])].sort(),
      apply: (edit) => {
        if (this.vault !== vault || this.area !== area || area.path !== path || editor.getDoc() !== text) {
          throw new Error('編集中にノートが変わりました。キャンセルして開き直してください。');
        }
        editor.applyTextEdit(edit);
      },
    });
  }

  private applySettings(): void {
    const data = this.settings?.data;
    if (!data) return;
    applyAppearance(data);
    this.index?.setAutoCollectTags(data.autoCollectTags);
    for (const pane of this.workspacePanes?.all ?? []) {
      pane.area.surfaces.editor.setLineNumbers(data.showLineNumbers);
      pane.area.surfaces.editor.applyEffects([refreshPreview.of(null)]);
    }
    this.rightPane?.refreshTheme();
    this.applyWatchInterval();
  }

  private applyWatchInterval(): void {
    const interval = this.settings?.data.pollInterval;
    if (!this.vault || interval === undefined || interval === this.watchInterval) return;
    this.watchInterval = interval;
    this.vault.startWatching({ intervalMs: interval });
    this.vault.setWatchingPaused(document.visibilityState === 'hidden');
  }

  private async refreshTree(): Promise<void> {
    if (!this.vault || !this.panes) return;
    try {
      // 一覧は1回だけ取り、ツリー用と添付用に振り分ける。
      const entries = await this.vault.listAll();
      this.panes.setEntries(entries, this.currentPath);
      this.embeds?.setEntries(entries);
    } catch (e) {
      this.toast(errorMessage(e), true);
    }
  }

  /** 選んだ画像をノート横の attachments にコピーし、本文用の相対参照を返す。 */
  private async addImageToNote(notePath: VPath | null): Promise<string | null> {
    const vault = this.vault;
    if (!vault || !notePath || !isMarkdown(notePath)) {
      this.toast('Markdownノートを開いてから画像を追加してください。', true);
      return null;
    }

    const file = await (this.deps.pickImageFile ?? pickImageFile)();
    if (!file) return null;
    const name = safeAttachmentName(file.name);
    if (!isEmbeddableImage(name)) {
      this.toast('PNG / JPEG / GIF / WebP / SVG / AVIF / BMP の画像を選んでください。', true);
      return null;
    }

    const folder = join(dirname(notePath), 'attachments');
    await vault.mkdir(folder);
    const target = await freeAttachmentPath(vault, folder, name);
    await vault.createBinary(target, await file.arrayBuffer());
    await this.refreshTree();
    const reference = relative(dirname(notePath), target);
    this.toast(`画像を ${target} に追加しました。`);
    return reference;
  }

  // --------------------------------------------------------------- ごみ箱






  private async reindexAll(force = false): Promise<void> {
    await this.refreshTree();
    if (!this.index) return;
    this.chrome?.setIndexStatus('再インデックス中…');
    await this.index.rebuild(undefined, force);
    this.onIndexChanged();
    this.toast(`インデックスを作り直しました（${this.index.report.ms}ms）。`);
  }

  // ----------------------------------------------------------- index 反映

  private onIndexChanged(): void {
    const index = this.index;
    if (!index) return;

    const stats = index.stats();
    this.chrome?.setIndexStatus(
      `${stats.notes} ノート / ${stats.links} リンク` +
      (stats.unresolved > 0 ? ` / 未解決 ${stats.unresolved}` : ''),
    );

    this.panes?.onIndexChanged(index);
    this.rightPane?.update(index, this.currentPath, true);
    this.graphModal?.refresh();
    for (const pane of this.workspacePanes?.all ?? []) pane.area.refreshDerived();

    for (const pane of this.workspacePanes?.all ?? []) {
      pane.area.surfaces.editor.applyEffects([refreshPreview.of(null)]);
    }
  }

  // ---------------------------------------------------------------- notes





  // ---------------------------------------------------------------- 文書

  /**
   * 文書を開く。種類ごとの違いは DocumentArea の中の View が引き受ける。
   * App は「どれを開くか」と「開いた結果を周りへ伝えること」だけを知る。
   */
  private async openDocument(path: VPath, offset?: number, target: OpenTarget = 'active'): Promise<void> {
    const panes = this.workspacePanes;
    if (!panes || !this.chrome) return;
    await panes.open(path, offset, target);
    this.chrome.setDrawerOpen(false);
    this.mobileNav?.setActive(null);
  }

  /**
   * 左右のパネルの表示を切り替える。
   *
   * 広い画面では桁ごと畳み、狭い画面ではかぶせて出す。
   * どちらの見え方でも「出す / しまう」の1状態として扱い、
   * 次に開いたときも同じ形になるよう覚えておく。
   */
  private togglePanel(side: 'sidebar' | 'rightbar'): void {
    const chrome = this.chrome;
    if (!chrome) return;

    if (side === 'sidebar') chrome.setSidebarShown(!chrome.isSidebarShown());
    else chrome.setRightbarShown(!chrome.isRightbarShown());
    this.scheduleLayoutSave();
  }

  /** いま開いているタブを基準に、その片側をまとめて閉じる。 */
  private async closeTabsBeside(side: 'left' | 'right' | 'both'): Promise<void> {
    const pane = this.workspacePanes?.active;
    const path = pane?.path;
    if (!pane || !path) return;

    const count = pane.countSide(path, side);
    if (count === 0) {
      this.toast(side === 'left' ? '左側にタブはありません。'
        : side === 'right' ? '右側にタブはありません。'
        : '他に開いているタブはありません。', true);
      return;
    }

    await pane.closeSide(path, side);
    this.toast(`${count} 件のタブを閉じました。`);
  }

  /** タブ・分割・選択が変わった。開き直したときに同じ形へ戻せるよう覚えておく。 */
  private onPanesChanged(): void {
    this.workspacePanes?.refreshTabs();
    this.onDocumentChanged();
    this.scheduleLayoutSave();
  }

  /**
   * 構成の保存はまとめて後回しにする。
   * タブ操作1回で何度も呼ばれるうえ、Vault へのファイル書き込みになるため。
   */
  private scheduleLayoutSave(): void {
    if (this.layoutTimer !== null) clearTimeout(this.layoutTimer);
    this.layoutTimer = setTimeout(() => void this.saveLayout(), 800);
  }

  private async saveLayout(): Promise<void> {
    if (this.layoutTimer !== null) clearTimeout(this.layoutTimer);
    this.layoutTimer = null;
    const vault = this.vault;
    const panes = this.workspacePanes;
    if (!vault || !panes) return;

    const chrome = this.chrome;
    const layout = normalizeLayout({
      ...panes.serialize(),
      sidebarShown: chrome?.isSidebarShown() ?? true,
      sidebarWidth: chrome?.getSidebarWidth() ?? 260,
      rightbarShown: chrome?.isRightbarShown() ?? true,
      expandedFolders: this.panes?.expandedFolders() ?? [],
    });
    this.pendingLayoutWrites++;
    // 連続開閉で古い書き込みが後から完了し、最新状態を戻してしまうのを防ぐ。
    this.layoutWrites = this.layoutWrites.then(async () => {
      try { await vault.writeNote(LAYOUT_PATH, serializeLayout(layout)); }
      catch { this.toast('フォルダの開閉状態を保存できませんでした。', true); }
      finally { this.pendingLayoutWrites--; }
    });
    await this.layoutWrites;
  }

  /** 前回開いていたタブと分割を復元する。失敗しても起動は続ける。 */
  private async restoreLayout(): Promise<void> {
    const vault = this.vault;
    const panes = this.workspacePanes;
    if (!vault || !panes) return;

    try {
      const stored = parseLayout((await vault.readNote(LAYOUT_PATH)).text);
      if (isEmptyLayout(stored)) return;
      this.panes?.restoreExpandedFolders(this.settings?.data.restoreFoldersOnStartup ? stored.expandedFolders ?? [] : []);
      this.chrome?.setSidebarShown(stored.sidebarShown);
      this.chrome?.setSidebarWidth(stored.sidebarWidth ?? 260);
      this.chrome?.setRightbarShown(stored.rightbarShown);
      if (this.settings?.data.restoreTabsOnStartup) await panes.restore(stored);
    } catch {
      /* 初回起動では存在しない */
    }
  }

  /** 開いている文書が変わった / 表示が切り替わった。 */
  private onDocumentChanged(): void {
    const chrome = this.chrome;
    const area = this.area;
    if (!chrome || !area) return;

    const path = area.path;
    chrome.setPath(path);
    this.panes?.setActive(path);
    const toolbarLanguage = area.mobileToolbarLanguage;
    if (toolbarLanguage !== null) this.mobileToolbar?.setLanguage(toolbarLanguage);
    this.mobileToolbar?.setVisible(toolbarLanguage !== null);
    if (this.index) this.rightPane?.update(this.index, path);
    this.rightPane?.setCurrentOffset(area.offset());
  }

  /** View が申告した表示切り替えを、そのままボタンにする。 */
  private renderModes(host: HTMLElement, modes: readonly DocumentMode[], active: string | null): void {
    host.replaceChildren();
    host.style.display = modes.length === 0 ? 'none' : '';

    for (const mode of modes) {
      const modeButton = button(mode.label, 'html-view-mode', () => this.area?.setMode(mode.id));
      const on = mode.id === active;
      modeButton.classList.toggle('active', on);
      modeButton.setAttribute('aria-pressed', String(on));
      host.append(modeButton);
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
    if (kind === 'unresolved') await this.creator.fromName(label);
    else await this.openDocument(id);
  }

  private async followLink(target: string, aside = false): Promise<void> {
    const resolved = this.index?.resolve(target, this.currentPath ?? '') ?? null;
    if (resolved) await this.openDocument(resolved, undefined, aside ? 'other' : 'active');
    else await this.creator.fromName(target);
  }

  /**
   * 名前からノートを作る。
   * フォルダ指定が無ければ、いま開いているノートと同じフォルダに置く
   * （リンク解決が「近いものを優先」なので、関連ノートが自然にまとまる）。
   */









  // --------------------------------------------------------------- events





  // --------------------------------------------------------------- status

  private toast(message: string, isError = false): void {
    this.toaster.show(message, isError);
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function hasClipboardFiles(transfer: DataTransfer): boolean {
  if (transfer.files.length > 0) return true;
  if ([...transfer.items].some((item) => item.kind === 'file')) return true;
  return [...transfer.types].includes('Files');
}

/** 外部由来の名前から、主要OSのどれでも安全なファイル名を作る。 */
function safeAttachmentName(value: string): string {
  let name = basename(value.replace(/\\/g, '/'))
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  if (name === '') name = 'image.png';
  const stem = extname(name) === '' ? name : name.slice(0, -extname(name).length);
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) name = `_${name}`;
  return name;
}

/** 同名画像は上書きせず「名前 (2).png」のように空いている名前へ送る。 */
async function freeAttachmentPath(vault: VaultService, folder: VPath, name: string): Promise<VPath> {
  let target = join(folder, name);
  if (!await vault.exists(target)) return target;
  const extension = extname(name);
  const stem = extension === '' ? name : name.slice(0, -extension.length);
  for (let suffix = 2; suffix < 10_000; suffix++) {
    target = join(folder, `${stem} (${suffix})${extension}`);
    if (!await vault.exists(target)) return target;
  }
  throw new Error(`${folder} に画像を保存できる空き名がありません。`);
}
