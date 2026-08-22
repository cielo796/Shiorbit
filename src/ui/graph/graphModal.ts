import { buildGraph } from '../../core/graph/buildGraph';
import type { GraphInput } from '../../core/graph/types';
import { button, el } from '../dom';
import { GraphView } from './GraphView';

export interface GraphModalOptions {
  getInput: () => GraphInput[];
  currentId: () => string | null;
  onSelect: (id: string, kind: 'note' | 'unresolved', label: string) => void;
}

/** Ctrl+G で開く全体グラフ。画面いっぱいに使う。 */
export class GraphModal {
  private overlay: HTMLElement | null = null;
  private view: GraphView | null = null;
  private status: HTMLElement | null = null;
  private query = '';
  private includeUnresolved = false;
  private focusCurrent = false;

  constructor(private readonly opts: GraphModalOptions) {}

  get isOpen(): boolean {
    return this.overlay !== null;
  }

  open(): void {
    if (this.overlay) return;

    const overlay = el('div', 'graph-modal-overlay');
    const modal = el('div', 'graph-modal');

    const toolbar = el('div', 'graph-toolbar');

    const search = el('input', 'graph-search');
    search.type = 'search';
    search.placeholder = 'ノート名で絞り込む';
    search.addEventListener('input', () => {
      this.query = search.value;
      this.rebuild();
    });

    const unresolved = checkbox('未解決リンクも表示', this.includeUnresolved, (v) => {
      this.includeUnresolved = v;
      this.rebuild();
    });

    const focus = checkbox('現在のノートの周辺だけ', this.focusCurrent, (v) => {
      this.focusCurrent = v;
      this.rebuild();
    });

    this.status = el('span', 'graph-status', '');

    toolbar.append(
      el('span', 'graph-title', 'グラフ'),
      search,
      unresolved,
      focus,
      el('span', 'spacer'),
      this.status,
      button('表示をリセット', 'ghost', () => this.view?.resetView()),
      button('✕', 'ghost', () => this.close()),
    );

    this.view = new GraphView({
      onSelect: (id, kind, label) => {
        this.close();
        this.opts.onSelect(id, kind, label);
      },
      currentId: () => this.opts.currentId(),
    });

    modal.append(toolbar, this.view.dom);
    overlay.append(modal);
    document.body.append(overlay);
    this.overlay = overlay;

    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) this.close();
    });
    document.addEventListener('keydown', this.onKey);

    // レイアウト確定後にサイズを測る
    setTimeout(() => {
      this.view?.resize();
      this.rebuild();
    }, 0);
  }

  close(): void {
    document.removeEventListener('keydown', this.onKey);
    this.view?.destroy();
    this.view = null;
    this.overlay?.remove();
    this.overlay = null;
    this.status = null;
  }

  /** インデックスが変わったら描き直す */
  refresh(): void {
    if (this.overlay) this.rebuild();
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  };

  private rebuild(): void {
    const view = this.view;
    if (!view) return;

    const current = this.opts.currentId();
    const graph = buildGraph(this.opts.getInput(), {
      includeUnresolved: this.includeUnresolved,
      query: this.query,
      ...(this.focusCurrent && current ? { focus: { id: current, depth: 2 } } : {}),
      maxNodes: 2000,
    });

    view.setData(graph);
    view.resize();
    if (this.status) {
      this.status.textContent = `${graph.nodes.length} ノート / ${graph.links.length} リンク`;
    }
  }
}

function checkbox(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const wrap = el('label', 'graph-check');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked));
  wrap.append(input, el('span', undefined, label));
  return wrap;
}
