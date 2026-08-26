import type { Entry, VPath } from '../core/vault/types';
import { basename, dirname, isHtml, isMarkdown } from '../core/vault/path';

export type ExplorerFilter = 'all' | 'markdown' | 'html';

export interface ExplorerOptions {
  onOpen: (path: VPath) => void;
  onRename: (path: VPath) => void;
  onDelete: (path: VPath) => void;
  /** そのフォルダを作成先として新規作成する。 */
  onCreateIn: (dir: VPath) => void;
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
  private active: VPath | null = null;
  private filter: ExplorerFilter = 'all';
  private readonly collapsed = new Set<VPath>();

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
    this.dom.append(filters, this.treeHost);
    this.updateFilterButtons();
  }

  setEntries(entries: Entry[]): void {
    this.entries = entries;
    this.render();
  }

  setActive(path: VPath | null): void {
    this.active = path;
    this.render();
  }

  setFilter(filter: ExplorerFilter): void {
    this.filter = filter;
    this.updateFilterButtons();
    this.render();
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
    return isMarkdown(path) || isHtml(path);
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
    if (node.path === this.active) row.classList.add('active');

    const caret = document.createElement('span');
    caret.className = 'caret';
    const icon = document.createElement('span');
    icon.className = 'icon';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = node.kind === 'file' ? stripMd(node.name) : node.name;
    label.title = node.path;

    if (node.kind === 'dir') {
      const isCollapsed = this.collapsed.has(node.path);
      if (isCollapsed) li.classList.add('collapsed');
      caret.textContent = isCollapsed ? '▶' : '▼';
      icon.textContent = '📁';
      row.addEventListener('click', () => {
        if (this.collapsed.has(node.path)) this.collapsed.delete(node.path);
        else this.collapsed.add(node.path);
        this.render();
      });
    } else {
      caret.textContent = '';
      icon.textContent = '📄';
      row.addEventListener('click', () => this.opts.onOpen(node.path));
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
