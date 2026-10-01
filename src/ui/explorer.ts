import type { Entry, VPath } from '../core/vault/types';
import type { NewDocumentKind } from '../core/notes/newDocument';
import { basename, dirname, isBase, isCanvas, isHtml, isMarkdown } from '../core/vault/path';
import { openContextMenu } from './contextMenu';
import {
  bindFileDrop,
  bindInternalFileMove,
  markInternalFileDrag,
  type DropTarget,
  type FileDropHandler,
  type FileMoveHandler,
} from './fileDrop';

export type ExplorerFilter = 'all' | 'markdown' | 'html';

export interface ExplorerOptions {
  onOpen: (path: VPath) => void;
  onRename: (path: VPath) => void;
  onDelete: (path: VPath) => void;
  /** そのフォルダを作成先として新規作成する。 */
  onCreateIn: (dir: VPath, kind?: NewDocumentKind) => void;
  onDropFiles?: FileDropHandler;
  /** Vault 内の既存ファイルを指定フォルダへ移す。 */
  onMoveFile?: FileMoveHandler;
  onFolderStateChanged?: () => void;
}

interface Node {
  path: VPath;
  name: string;
  kind: 'file' | 'dir';
  children: Node[];
}

/** フラットな Entry[] からツリーを描く。Vault の中身を知っているだけで、保存方法は知らない。 */
export class Explorer {
  readonly dom: HTMLElement;
  private readonly treeHost: HTMLElement;
  private entries: Entry[] = [];
  private entriesLoaded = false;
  private active: VPath | null = null;
  private filter: ExplorerFilter = 'all';
  /** 保存されていないフォルダは閉じる。子の展開状態は親を閉じても保持する。 */
  private readonly expanded = new Set<VPath>();
  private readonly rows = new Map<VPath, HTMLElement>();
  /** Ctrl+V で外部ファイルを取り込む保存先。空文字は Vault 直下。 */
  private pasteDir: VPath = '';
  private pasteHighlight: VPath = '';
  /** ユーザーが行を選んだ後は、一覧更新で現在のノート側へ戻さない。 */
  private pasteDirExplicit = false;

  constructor(private readonly opts: ExplorerOptions) {
    this.dom = document.createElement('div');
    this.dom.className = 'explorer-pane';

    const filters = document.createElement('div');
    filters.className = 'file-filters';
    filters.setAttribute('role', 'group');
    filters.setAttribute('aria-label', '表示するファイル形式');
    const choices: Array<{ id: ExplorerFilter; label: string; title: string }> = [
      { id: 'all', label: '両方', title: 'MarkdownとHTMLを表示' },
      { id: 'markdown', label: 'MD', title: 'Markdownだけを表示' },
      { id: 'html', label: 'HTML', title: 'HTMLだけを表示' },
    ];
    for (const choice of choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'file-filter';
      button.dataset['filter'] = choice.id;
      button.textContent = choice.label;
      button.title = choice.title;
      button.addEventListener('click', () => this.setFilter(choice.id));
      filters.append(button);
    }

    this.treeHost = document.createElement('div');
    this.treeHost.className = 'sidebar-body';
    this.treeHost.tabIndex = 0;
    this.treeHost.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('.row')) return;
      this.setPasteDestination('');
      this.treeHost.focus();
    });
    const resolveDropTarget = (target: EventTarget | null): DropTarget => {
      const row = target instanceof Element ? target.closest<HTMLElement>('.row') : null;
      if (!row) return { path: '', element: this.treeHost };
      const path = row.dataset['kind'] === 'dir' ? row.dataset['path']! : dirname(row.dataset['path']!);
      if (path === '') return { path, element: this.treeHost };
      return { path, element: this.findRow(path) ?? this.treeHost };
    };
    if (opts.onDropFiles) {
      this.treeHost.title = 'MD / HTMLファイルをドロップ（ファイル行は同じフォルダ、余白はルートに保存）';
      bindFileDrop(this.treeHost, opts.onDropFiles, resolveDropTarget);
    }
    if (opts.onMoveFile) {
      bindInternalFileMove(this.treeHost, opts.onMoveFile, resolveDropTarget);
    }
    this.dom.append(filters, this.treeHost);
    this.updateFilterButtons();
  }

  setEntries(entries: Entry[]): void {
    if (this.entriesLoaded && entries.length === this.entries.length && entries.every((entry, i) => {
      const old = this.entries[i]!;
      return entry.path === old.path && entry.kind === old.kind && entry.name === old.name;
    })) return;
    this.entriesLoaded = true;
    this.entries = entries;
    this.render();
  }

  setActive(path: VPath | null): void {
    if (this.active !== path) {
      const previous = this.active;
      this.active = path;
      this.findRow(previous)?.classList.remove('active');
      this.findRow(path)?.classList.add('active');
    }
    if (path !== null) this.setPasteDestination(dirname(path), false);
  }

  pasteDestination(): VPath {
    return this.pasteDir;
  }

  /** 新規ファイルを見える位置に出し、編集欄のフォーカスは奪わない。 */
  revealCreated(path: VPath): void {
    this.setPasteDestination(dirname(path), true, path);
    this.setActive(path);
    this.revealImported(path);
  }

  expandedFolders(): VPath[] {
    return [...this.expanded];
  }

  restoreExpandedFolders(paths: readonly VPath[]): void {
    this.expanded.clear();
    for (const path of paths) this.expanded.add(path);
    for (const [path, row] of this.rows) {
      if (row.dataset['kind'] !== 'dir') continue;
      this.updateFolderState(path, row.parentElement!, row, row.querySelector<HTMLButtonElement>('button.caret')!);
    }
  }

  setFilter(filter: ExplorerFilter): void {
    if (this.filter === filter) return;
    this.filter = filter;
    this.updateFilterButtons();
    this.render();
  }

  /** 取り込み後は保存先を展開する。編集対象や他のフォルダの開閉状態は変えない。 */
  revealImported(path: VPath): void {
    let changed = false;
    for (let dir = dirname(path); dir !== ''; dir = dirname(dir)) {
      if (!this.expanded.has(dir)) { this.expanded.add(dir); changed = true; }
    }
    if ((isMarkdown(path) && this.filter === 'html') || (isHtml(path) && this.filter === 'markdown')) {
      this.filter = 'all';
    }
    this.updateFilterButtons();
    this.render();
    [...this.treeHost.querySelectorAll<HTMLElement>('.row')]
      .find((row) => row.dataset['path'] === path)?.scrollIntoView({ block: 'nearest' });
    if (changed) this.opts.onFolderStateChanged?.();
  }

  private buildTree(): Node[] {
    const map = new Map<VPath, Node>();
    const roots: Node[] = [];

    const ensureDir = (path: VPath): Node | null => {
      if (path === '') return null;
      const found = map.get(path);
      if (found) return found;
      const node: Node = { path, name: basename(path), kind: 'dir', children: [] };
      map.set(path, node);
      const parent = ensureDir(dirname(path));
      (parent ? parent.children : roots).push(node);
      return node;
    };

    // 空のフォルダも作った直後に見えるよう、ディレクトリは実体として登録する。
    for (const e of this.entries) {
      if (e.kind === 'dir') ensureDir(e.path);
    }

    for (const e of this.entries) {
      if (e.kind === 'dir' || !this.matchesFilter(e.path)) continue;
      const node: Node = { path: e.path, name: e.name, kind: 'file', children: [] };
      const parent = ensureDir(dirname(e.path));
      (parent ? parent.children : roots).push(node);
    }

    // 形式で絞り込んでいる間は、該当ファイルを持たないフォルダを畳んで隠す。
    if (this.filter !== 'all') prune(roots);

    const sort = (nodes: Node[]): void => {
      nodes.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name, 'ja', { numeric: true });
      });
      for (const n of nodes) sort(n.children);
    };
    sort(roots);
    return roots;
  }

  private render(): void {
    this.rows.clear();
    this.treeHost.replaceChildren();
    const roots = this.buildTree();

    if (roots.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tree-empty';
      empty.textContent = '該当するファイルがありません。';
      this.treeHost.append(empty);
      return;
    }

    this.treeHost.append(this.renderList(roots));
  }

  private matchesFilter(path: VPath): boolean {
    if (this.filter === 'markdown') return isMarkdown(path);
    if (this.filter === 'html') return isHtml(path);
    return isMarkdown(path) || isHtml(path) || isBase(path) || isCanvas(path);
  }

  private updateFilterButtons(): void {
    for (const button of this.dom.querySelectorAll<HTMLButtonElement>('.file-filter')) {
      const active = button.dataset['filter'] === this.filter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  private renderList(nodes: Node[]): HTMLUListElement {
    const ul = document.createElement('ul');
    ul.className = 'tree';
    for (const node of nodes) ul.append(this.renderNode(node));
    return ul;
  }

  private renderNode(node: Node): HTMLLIElement {
    const li = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset['path'] = node.path;
    row.dataset['kind'] = node.kind;
    this.rows.set(node.path, row);
    if (node.path === this.active) row.classList.add('active');
    if (node.path === this.pasteHighlight) row.classList.add('paste-target');

    const caret = node.kind === 'dir'
      ? document.createElement('button')
      : document.createElement('span');
    caret.className = node.kind === 'dir' ? 'caret' : 'caret caret-spacer';
    const icon = document.createElement('span');
    icon.className = 'icon';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = node.kind === 'file' ? stripMd(node.name) : node.name;
    label.title = node.path;

    if (node.kind === 'dir') {
      const caretButton = caret as HTMLButtonElement;
      const isCollapsed = !this.expanded.has(node.path);
      if (isCollapsed) li.classList.add('collapsed');
      caretButton.type = 'button';
      this.updateFolderState(node.path, li, row, caretButton);
      caretButton.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        this.toggleFolder(node.path);
      });
      caretButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        // キーボードや HTMLElement.click() では pointerdown が発生しない。
        if (event.detail === 0) this.toggleFolder(node.path);
      });
      icon.textContent = '📁';
      row.tabIndex = 0;
      row.setAttribute('aria-label', `${node.name} フォルダ`);
      row.setAttribute('aria-haspopup', 'menu');
      row.addEventListener('click', () => this.toggleFolder(node.path));
      row.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.setPasteDestination(node.path);
        row.focus();
        this.openFolderMenu(node.path, event.clientX, event.clientY);
      });
      row.addEventListener('keydown', (event) => {
        // 行内の＋や削除ボタンのキー操作は、そのボタンに任せる。
        if (event.target !== row) return;
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault();
          event.stopPropagation();
          const rect = row.getBoundingClientRect();
          this.openFolderMenu(node.path, rect.left, rect.bottom);
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.toggleFolder(node.path);
        }
      });
    } else {
      caret.textContent = '';
      icon.textContent = isBase(node.path) ? '📊' : isCanvas(node.path) ? '🗺' : '📄';
      row.tabIndex = 0;
      row.setAttribute('aria-label', `${node.name} ファイル`);
      row.setAttribute('aria-haspopup', 'menu');
      row.addEventListener('click', () => {
        this.setPasteDestination(dirname(node.path));
        this.opts.onOpen(node.path);
      });
      row.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.setPasteDestination(dirname(node.path), true, node.path);
        row.focus();
        this.openFileMenu(node.path, event.clientX, event.clientY);
      });
      row.addEventListener('keydown', (event) => {
        if (event.target !== row) return;
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault();
          event.stopPropagation();
          this.setPasteDestination(dirname(node.path), true, node.path);
          const rect = row.getBoundingClientRect();
          this.openFileMenu(node.path, rect.left, rect.bottom);
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.setPasteDestination(dirname(node.path));
          this.opts.onOpen(node.path);
        }
      });
      if (this.opts.onMoveFile) {
        row.draggable = true;
        row.title = 'ドラッグして別のフォルダへ移動';
        row.addEventListener('dragstart', (event) => {
          if (!markInternalFileDrag(event, node.path)) return;
          row.classList.add('file-move-source');
        });
        row.addEventListener('dragend', () => row.classList.remove('file-move-source'));
      }
    }

    row.append(caret, icon, label);

    if (node.kind === 'dir') {
      const create = document.createElement('button');
      create.className = 'ghost row-action create';
      create.textContent = '＋';
      create.title = 'このフォルダの中に新規作成';
      create.addEventListener('click', (event) => {
        event.stopPropagation();
        this.opts.onCreateIn(node.path);
      });
      row.append(create);
    }

    if (node.kind === 'file') {
      const rename = document.createElement('button');
      rename.className = 'ghost row-action rename';
      rename.textContent = '✎';
      rename.title = '名前を変更';
      rename.addEventListener('click', (event) => {
        event.stopPropagation();
        this.opts.onRename(node.path);
      });
      row.append(rename);
    }

    const del = document.createElement('button');
    del.className = 'ghost row-action del';
    del.textContent = '✕';
    del.title = '削除';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      this.opts.onDelete(node.path);
    });
    row.append(del);

    li.append(row);
    if (node.children.length > 0) li.append(this.renderList(node.children));
    return li;
  }

  private toggleFolder(path: VPath): void {
    this.setPasteDestination(path);
    if (this.expanded.has(path)) this.expanded.delete(path);
    else this.expanded.add(path);
    const row = this.findRow(path);
    const li = row?.parentElement;
    const caret = row?.querySelector<HTMLButtonElement>('.caret');
    if (row && li && caret) this.updateFolderState(path, li, row, caret);
    row?.focus();
    this.opts.onFolderStateChanged?.();
  }

  private setPasteDestination(path: VPath, explicit = true, highlight: VPath = path): void {
    if (!explicit && this.pasteDirExplicit) return;
    if (explicit) this.pasteDirExplicit = true;
    if (this.pasteDir === path && this.pasteHighlight === highlight) return;
    this.findRow(this.pasteHighlight)?.classList.remove('paste-target');
    this.pasteDir = path;
    this.pasteHighlight = highlight;
    this.findRow(highlight)?.classList.add('paste-target');
  }

  /** 開閉時はツリー全体を作り直さず、対象フォルダの表示状態だけを更新する。 */
  private updateFolderState(
    path: VPath,
    li: HTMLElement,
    row: HTMLElement,
    caret: HTMLButtonElement,
  ): void {
    const isCollapsed = !this.expanded.has(path);
    li.classList.toggle('collapsed', isCollapsed);
    row.setAttribute('aria-expanded', String(!isCollapsed));
    caret.textContent = isCollapsed ? '▶' : '▼';
    caret.title = isCollapsed ? 'フォルダを展開' : 'フォルダを折りたたむ';
    caret.setAttribute('aria-label', caret.title);
    caret.setAttribute('aria-expanded', String(!isCollapsed));
  }

  private findRow(path: VPath | null): HTMLElement | null {
    if (path === null) return null;
    return this.rows.get(path) ?? null;
  }

  private openFolderMenu(path: VPath, x: number, y: number): void {
    openContextMenu(x, y, [
      { label: 'Markdownを新規作成…', run: () => this.opts.onCreateIn(path, 'markdown') },
      { label: 'HTMLを新規作成…', run: () => this.opts.onCreateIn(path, 'html') },
      { label: 'サブフォルダを作成…', run: () => this.opts.onCreateIn(path, 'folder') },
      {
        label: this.expanded.has(path) ? 'フォルダを折りたたむ' : 'フォルダを展開',
        run: () => this.toggleFolder(path),
      },
      { label: 'ごみ箱へ移す…', danger: true, run: () => this.opts.onDelete(path) },
    ]);
  }

  private openFileMenu(path: VPath, x: number, y: number): void {
    const dir = dirname(path);
    openContextMenu(x, y, [
      { label: '開く', run: () => this.opts.onOpen(path) },
      { label: '名前を変更…', run: () => this.opts.onRename(path) },
      { label: '同じフォルダに新規作成', children: [
        { label: 'Markdownを新規作成…', run: () => this.opts.onCreateIn(dir, 'markdown') },
        { label: 'HTMLを新規作成…', run: () => this.opts.onCreateIn(dir, 'html') },
      ] },
      { label: 'ごみ箱へ移す…', danger: true, run: () => this.opts.onDelete(path) },
    ]);
  }
}

/** 子孫にファイルを1つも持たないフォルダを取り除く。 */
function prune(nodes: Node[]): void {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]!;
    if (node.kind !== 'dir') continue;
    prune(node.children);
    if (node.children.length === 0) nodes.splice(i, 1);
  }
}

function stripMd(name: string): string {
  return name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name;
}
