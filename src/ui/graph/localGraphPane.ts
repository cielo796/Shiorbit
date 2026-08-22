import { buildGraph } from '../../core/graph/buildGraph';
import type { GraphInput } from '../../core/graph/types';
import { button, el } from '../dom';
import { GraphView } from './GraphView';

export interface LocalGraphPaneOptions {
  onSelect: (id: string, kind: 'note' | 'unresolved', label: string) => void;
  currentId: () => string | null;
  onExpand: () => void;
}

const DEPTHS = [1, 2, 3];

/**
 * 右ペインのローカルグラフ。
 *
 * 開いているノートの周辺だけを描く。
 * 全体グラフをいきなり出すと、ノートが増えたときに何も読み取れなくなるうえ、
 * モバイルでは重い。まず「近所」を見せるのが実用的（設計書 §8）。
 */
export class LocalGraphPane {
  readonly dom: HTMLElement;
  private readonly view: GraphView;
  private readonly countLabel: HTMLElement;
  private readonly depthButtons = new Map<number, HTMLButtonElement>();
  private depth = 2;
  private input: GraphInput[] = [];

  constructor(private readonly opts: LocalGraphPaneOptions) {
    this.dom = el('section', 'pane-section pane-graph');

    const header = el('div', 'pane-header');
    header.append(el('span', undefined, 'ローカルグラフ'));

    const depths = el('span', 'graph-depths');
    for (const d of DEPTHS) {
      const b = button(String(d), 'depth', () => this.setDepth(d));
      b.title = `深さ ${d} まで表示`;
      this.depthButtons.set(d, b);
      depths.append(b);
    }
    const expand = button('⤢', 'ghost', () => this.opts.onExpand());
    expand.title = '全体グラフを開く (Ctrl+G)';
    header.append(depths, expand);

    this.view = new GraphView({
      onSelect: (id, kind, label) => this.opts.onSelect(id, kind, label),
      currentId: () => this.opts.currentId(),
      compact: true,
    });

    this.countLabel = el('div', 'graph-count', '');
    this.dom.append(header, this.view.dom, this.countLabel);
    this.syncDepthButtons();
  }

  setDepth(depth: number): void {
    this.depth = depth;
    this.syncDepthButtons();
    this.rebuild();
  }

  update(input: GraphInput[]): void {
    this.input = input;
    this.rebuild();
  }

  refreshTheme(): void {
    this.view.refreshTheme();
  }

  destroy(): void {
    this.view.destroy();
  }

  private syncDepthButtons(): void {
    for (const [d, b] of this.depthButtons) b.classList.toggle('active', d === this.depth);
  }

  private rebuild(): void {
    const focusId = this.opts.currentId();
    if (focusId === null) {
      this.view.setData({ nodes: [], links: [] });
      this.countLabel.textContent = 'ノートを開くと周辺のつながりが出ます';
      return;
    }

    const graph = buildGraph(this.input, {
      includeUnresolved: true,
      focus: { id: focusId, depth: this.depth },
      maxNodes: 300,
    });
    this.view.setData(graph);
    this.view.resize();
    this.countLabel.textContent =
      graph.nodes.length <= 1
        ? 'つながっているノートはまだありません'
        : `${graph.nodes.length} ノート / ${graph.links.length} リンク`;
  }
}
