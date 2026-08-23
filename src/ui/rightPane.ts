import type { Indexer } from '../core/index/Indexer';
import type { VPath } from '../core/vault/types';
import { BacklinksPane } from './backlinksPane';
import { LocalGraphPane } from './graph/localGraphPane';
import { OutlinePane } from './outlinePane';
import { el } from './dom';

export interface RightPaneOptions {
  onOpen: (path: VPath, offset?: number) => void;
  onCreate: (name: string) => void;
  onReveal: (offset: number) => void;
  onGraphSelect: (id: string, kind: 'note' | 'unresolved', label: string) => void;
  currentPath: () => VPath | null;
  onExpandGraph: () => void;
}

/** 右ペインの各表示をまとめ、App からペイン固有の更新順序を隠す。 */
export class RightPane {
  readonly dom: HTMLElement;
  private readonly outline: OutlinePane;
  private readonly localGraph: LocalGraphPane;
  private readonly backlinks: BacklinksPane;

  constructor(opts: RightPaneOptions) {
    this.outline = new OutlinePane({ onReveal: opts.onReveal });
    this.localGraph = new LocalGraphPane({
      onSelect: opts.onGraphSelect,
      currentId: opts.currentPath,
      onExpand: opts.onExpandGraph,
    });
    this.backlinks = new BacklinksPane({ onOpen: opts.onOpen, onCreate: opts.onCreate });
    this.dom = el('aside', 'rightbar');
    this.dom.append(this.outline.dom, this.localGraph.dom, this.backlinks.dom);
  }

  update(index: Indexer, path: VPath | null): void {
    this.localGraph.update(index.graphInput());
    this.outline.setHeadings(path ? (index.getMeta(path)?.headings ?? []) : []);
    if (path) this.backlinks.setNote(path, index.backlinks(path), index.outgoing(path));
    else this.backlinks.setNote(null, [], []);
  }

  setCurrentOffset(offset: number): void {
    this.outline.setCurrentOffset(offset);
  }

  refreshTheme(): void {
    this.localGraph.refreshTheme();
  }

  destroy(): void {
    this.localGraph.destroy();
  }
}
