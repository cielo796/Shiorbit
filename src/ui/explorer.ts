import type { Entry, VPath } from '../core/vault/types';
import { basename, dirname } from '../core/vault/path';

export interface ExplorerOptions {
  onOpen: (path: VPath) => void;
  onDelete: (path: VPath) => void;
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
  private entries: Entry[] = [];
  private active: VPath | null = null;
  private readonly collapsed = new Set<VPath>();

  constructor(private readonly opts: ExplorerOptions) {
    this.dom = document.createElement('div');
    this.dom.className = 'sidebar-body';
  }

  setEntries(entries: Entry[]): void {
    this.entries = entries;
    this.render();
  }

  setActive(path: VPath | null): void {
    this.active = path;
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

    for (const e of this.entries) {
      if (e.kind === 'dir') {
        ensureDir(e.path);
      } else {
        const node: Node = { path: e.path, name: e.name, kind: 'file', children: [] };
        const parent = ensureDir(dirname(e.path));
        (parent ? parent.children : roots).push(node);
      }
    }

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
    this.dom.replaceChildren();
    const roots = this.buildTree();

    if (roots.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tree-empty';
      empty.textContent = 'ノートがありません。「+ 新規」で作成してください。';
      this.dom.append(empty);
      return;
    }

    this.dom.append(this.renderList(roots));
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

    const del = document.createElement('button');
    del.className = 'ghost del';
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

function stripMd(name: string): string {
  return name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name;
}
