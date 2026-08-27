import type { Indexer } from '../core/index/Indexer';
import type { TrashEntry } from '../core/vault/trash';
import type { Entry, VPath } from '../core/vault/types';
import { isOpenable } from '../core/vault/path';
import { CleanupPane } from './cleanupPane';
import { Explorer } from './explorer';
import { SearchPane } from './searchPane';
import { TagPane } from './tagPane';
import { UnresolvedPane } from './unresolvedPane';
import type { WorkspaceTab } from './workspaceChrome';

export interface SidebarPanesOptions {
  index: () => Indexer | null;
  open: (path: VPath, offset?: number) => void;
  create: (name: string) => void;
  createIn: (dir: VPath) => void;
  rename: (path: VPath) => void;
  moveToTrash: (path: VPath) => void;
  restore: (entry: TrashEntry) => void;
  purge: (entry?: TrashEntry) => void;
  removeConflicts: (paths?: readonly VPath[]) => void;
}

/**
 * 左サイドバーのペイン一式。
 *
 * どれも「索引の内容を別の切り口で見せる」ものなので、
 * 生成と更新をまとめて App の仕事を減らす。
 */
export class SidebarPanes {
  private readonly explorer: Explorer;
  private readonly search: SearchPane;
  private readonly tags: TagPane;
  private readonly unresolved: UnresolvedPane;
  readonly cleanup: CleanupPane;

  constructor(opts: SidebarPanesOptions) {
    this.explorer = new Explorer({
      onOpen: (path) => opts.open(path),
      onRename: (path) => opts.rename(path),
      onDelete: (path) => opts.moveToTrash(path),
      onCreateIn: (dir) => opts.createIn(dir),
    });
    this.search = new SearchPane({
      search: (query) => opts.index()?.searchNotes(query) ?? Promise.resolve([]),
      onOpen: (path) => opts.open(path),
    });
    this.tags = new TagPane({ onOpen: (path) => opts.open(path) });
    this.unresolved = new UnresolvedPane({
      onCreate: (name) => opts.create(name),
      onOpen: (path, offset) => opts.open(path, offset),
    });
    this.cleanup = new CleanupPane({
      onRestore: (entry) => opts.restore(entry),
      onPurge: (entry) => opts.purge(entry),
      onPurgeAll: () => opts.purge(),
      onOpenConflict: (path) => opts.open(path),
      onDeleteConflict: (path) => opts.removeConflicts([path]),
      onDeleteAllConflicts: () => opts.removeConflicts(),
    });
  }

  domFor(tab: WorkspaceTab): HTMLElement {
    switch (tab) {
      case 'files':
        return this.explorer.dom;
      case 'search':
        return this.search.dom;
      case 'tags':
        return this.tags.dom;
      case 'trash':
        return this.cleanup.dom;
      case 'unresolved':
        return this.unresolved.dom;
    }
  }

  focus(tab: WorkspaceTab): void {
    if (tab === 'search') this.search.focus();
  }

  /** ツリーに出すのは、開けるファイルとフォルダだけ。 */
  setEntries(entries: readonly Entry[], active: VPath | null): void {
    this.explorer.setEntries(entries.filter((e) => e.kind === 'dir' || isOpenable(e.path)));
    this.explorer.setActive(active);
  }

  setActive(path: VPath | null): void {
    this.explorer.setActive(path);
  }

  onIndexChanged(index: Indexer): void {
    this.unresolved.setGroups(index.unresolved());
    this.tags.setTags(index.tags());
    this.search.refresh();
  }
}
