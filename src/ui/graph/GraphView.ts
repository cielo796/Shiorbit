import { nodeRadius } from '../../core/graph/layout';
import { emptyGraph, isUnresolvedId, type GraphData } from '../../core/graph/types';
import { startLayout, type LayoutSession } from './layoutSession';

export interface GraphViewOptions {
  /** ノードをクリックしたとき。未解決ノードなら kind='unresolved' が来る。 */
  onSelect: (id: string, kind: 'note' | 'unresolved', label: string) => void;
  /** 強調表示する現在のノート */
  currentId?: () => string | null;
  /** 小さいペインでは常時ラベルを出さない */
  compact?: boolean;
}

interface Palette {
  bg: string;
  link: string;
  node: string;
  nodeDim: string;
  unresolved: string;
  accent: string;
  label: string;
  labelDim: string;
}

const DRAG_THRESHOLD = 4;

/**
 * Canvas 2D によるグラフ描画。
 *
 * 座標計算は Worker 側 (layoutSession) が担当し、ここは描画と操作だけを受け持つ。
 * 1000 ノード程度なら Canvas 2D で十分滑らかに動く。
 * これを大きく超える規模になったら WebGL に載せ替える（設計書 §10）。
 */
export class GraphView {
  readonly dom: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;

  private data: GraphData = emptyGraph();
  private session: LayoutSession | null = null;
  private pendingLayout = false;

  private ids: string[] = [];
  private indexOf = new Map<string, number>();
  private xs: Float32Array = new Float32Array(0);
  private ys: Float32Array = new Float32Array(0);
  private neighbors = new Map<string, Set<string>>();

  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private hovered: string | null = null;

  private pointerDown: { x: number; y: number; moved: boolean; node: string | null } | null = null;
  private frame: number | null = null;
  private observer: ResizeObserver | null = null;
  private palette: Palette;

  constructor(private readonly opts: GraphViewOptions) {
    this.dom = document.createElement('div');
    this.dom.className = 'graph-view';

    this.canvas = document.createElement('canvas');
    this.dom.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.palette = readPalette(this.dom);

    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.canvas.addEventListener('pointerleave', () => {
      this.hovered = null;
      this.schedule();
    });
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(this.dom);
    }
  }

  get nodeCount(): number {
    return this.data.nodes.length;
  }

  setData(data: GraphData): void {
    if (sameGraph(this.data, data)) {
      this.schedule();
      return;
    }
    this.session?.stop();
    this.session = null;
    this.data = data;
    this.pendingLayout = data.nodes.length > 0;

    this.ids = data.nodes.map((n) => n.id);
    this.indexOf = new Map(this.ids.map((id, i) => [id, i]));
    this.xs = new Float32Array(this.ids.length);
    this.ys = new Float32Array(this.ids.length);

    this.neighbors = new Map(this.ids.map((id) => [id, new Set<string>()]));
    for (const link of data.links) {
      this.neighbors.get(link.source)?.add(link.target);
      this.neighbors.get(link.target)?.add(link.source);
    }

    this.resetView();

    this.startPendingLayout();
  }

  private startPendingLayout(): void {
    if (!this.pendingLayout || !this.isVisible()) return;
    this.pendingLayout = false;
    const { width, height } = this.size();
    const session = startLayout(this.data, width, height);
    session.onIds((ids) => {
      this.ids = ids;
      this.indexOf = new Map(ids.map((id, i) => [id, i]));
    });
    session.onTick(({ xs, ys }) => {
      this.xs = xs;
      this.ys = ys;
      this.schedule();
    });
    this.session = session;
  }

  refreshTheme(): void {
    this.palette = readPalette(this.dom);
    this.schedule();
  }

  resize(): void {
    if (!this.isVisible()) {
      this.session?.stop();
      this.session = null;
      this.pendingLayout = this.data.nodes.length > 0;
      return;
    }
    const { width, height } = this.size();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelsX = Math.max(1, Math.round(width * dpr));
    const pixelsY = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== pixelsX) this.canvas.width = pixelsX;
    if (this.canvas.height !== pixelsY) this.canvas.height = pixelsY;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.startPendingLayout();
    this.schedule();
  }

  resetView(): void {
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.schedule();
  }

  destroy(): void {
    this.session?.stop();
    this.session = null;
    this.observer?.disconnect();
    if (this.frame !== null) cancelAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------------ 描画

  private size(): { width: number; height: number } {
    const rect = this.dom.getBoundingClientRect();
    return {
      width: Math.max(1, Math.round(rect.width) || 300),
      height: Math.max(1, Math.round(rect.height) || 200),
    };
  }

  private isVisible(): boolean {
    if (!this.ctx) return false;
    const rect = this.dom.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  private schedule(): void {
    if (this.frame !== null || !this.isVisible()) return;
    const raf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: FrameRequestCallback): number => setTimeout(() => cb(0), 16) as unknown as number;
    this.frame = raf(() => {
      this.frame = null;
      this.draw();
    });
  }

  private draw(): void {
    if (!this.isVisible()) return;
    const ctx = this.ctx;
    if (!ctx) return;

    const { width, height } = this.size();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (this.data.nodes.length === 0) return;

    const p = this.palette;
    const current = this.opts.currentId?.() ?? null;
    const focus = this.hovered ?? current;
    const near = focus ? (this.neighbors.get(focus) ?? new Set<string>()) : null;
    const dimmed = this.hovered !== null;

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    // --- 辺
    ctx.lineWidth = 1 / this.scale;
    for (const link of this.data.links) {
      const a = this.indexOf.get(link.source);
      const b = this.indexOf.get(link.target);
      if (a === undefined || b === undefined) continue;
      const active = focus !== null && (link.source === focus || link.target === focus);
      ctx.strokeStyle = active ? p.accent : p.link;
      ctx.globalAlpha = dimmed && !active ? 0.18 : active ? 0.85 : 0.45;
      ctx.beginPath();
      ctx.moveTo(this.xs[a]!, this.ys[a]!);
      ctx.lineTo(this.xs[b]!, this.ys[b]!);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // --- ノード
    for (const node of this.data.nodes) {
      const i = this.indexOf.get(node.id);
      if (i === undefined) continue;
      const x = this.xs[i]!;
      const y = this.ys[i]!;
      const r = nodeRadius(node.degree);
      const isFocus = node.id === focus;
      const isNear = near?.has(node.id) ?? false;

      ctx.globalAlpha = dimmed && !isFocus && !isNear ? 0.22 : 1;
      ctx.fillStyle = node.kind === 'unresolved' ? p.unresolved : isFocus || isNear ? p.node : p.nodeDim;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();

      if (node.id === current) {
        ctx.strokeStyle = p.accent;
        ctx.lineWidth = 2 / this.scale;
        ctx.beginPath();
        ctx.arc(x, y, r + 3.5 / this.scale, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // --- ラベル（ズームと次数に応じて間引く = LOD）
    const threshold = labelThreshold(this.scale, this.data.nodes.length, this.opts.compact ?? false);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `${11 / this.scale}px system-ui, sans-serif`;
    for (const node of this.data.nodes) {
      const i = this.indexOf.get(node.id);
      if (i === undefined) continue;
      const isFocus = node.id === focus;
      const isNear = near?.has(node.id) ?? false;
      if (!isFocus && !isNear && node.degree < threshold) continue;

      ctx.globalAlpha = dimmed && !isFocus && !isNear ? 0.25 : 1;
      ctx.fillStyle = isFocus ? p.label : p.labelDim;
      ctx.fillText(node.label, this.xs[i]!, this.ys[i]! + nodeRadius(node.degree) + 3 / this.scale);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // -------------------------------------------------------------- 操作

  private toWorld(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - this.offsetX) / this.scale,
      y: (e.clientY - rect.top - this.offsetY) / this.scale,
    };
  }

  private nodeAt(x: number, y: number): string | null {
    let best: string | null = null;
    let bestDist = Infinity;
    for (const node of this.data.nodes) {
      const i = this.indexOf.get(node.id);
      if (i === undefined) continue;
      const dx = this.xs[i]! - x;
      const dy = this.ys[i]! - y;
      const d = Math.hypot(dx, dy);
      const hit = nodeRadius(node.degree) + 6 / this.scale;
      if (d < hit && d < bestDist) {
        best = node.id;
        bestDist = d;
      }
    }
    return best;
  }

  private onPointerDown(e: PointerEvent): void {
    const world = this.toWorld(e);
    const node = this.nodeAt(world.x, world.y);
    this.pointerDown = { x: e.clientX, y: e.clientY, moved: false, node };
    this.canvas.setPointerCapture(e.pointerId);
  }

  private onPointerMove(e: PointerEvent): void {
    const world = this.toWorld(e);

    if (!this.pointerDown) {
      const hit = this.nodeAt(world.x, world.y);
      if (hit !== this.hovered) {
        this.hovered = hit;
        this.canvas.style.cursor = hit ? 'pointer' : 'grab';
        this.schedule();
      }
      return;
    }

    const dx = e.clientX - this.pointerDown.x;
    const dy = e.clientY - this.pointerDown.y;
    if (!this.pointerDown.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    this.pointerDown.moved = true;

    if (this.pointerDown.node) {
      this.session?.pin(this.pointerDown.node, world.x, world.y);
    } else {
      this.offsetX += e.movementX;
      this.offsetY += e.movementY;
      this.schedule();
    }
  }

  private onPointerUp(e: PointerEvent): void {
    const down = this.pointerDown;
    this.pointerDown = null;
    this.canvas.releasePointerCapture?.(e.pointerId);
    if (!down) return;

    if (down.node && down.moved) {
      this.session?.pin(down.node, null, null); // 離したら固定を解く
      return;
    }
    if (down.node && !down.moved) {
      const node = this.data.nodes.find((n) => n.id === down.node);
      if (node) this.opts.onSelect(node.id, node.kind, node.label);
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const world = this.toWorld(e);

    const factor = Math.exp(-e.deltaY * 0.0015);
    this.scale = Math.min(4, Math.max(0.15, this.scale * factor));
    this.offsetX = px - world.x * this.scale;
    this.offsetY = py - world.y * this.scale;
    this.schedule();
  }
}

/**
 * ラベルを出す最小次数。
 * ズームアウトしているほど、ノードが多いほど、名前の表示を絞る。
 */
function labelThreshold(scale: number, nodeCount: number, compact: boolean): number {
  if (compact) return scale >= 1.4 ? 0 : Infinity;
  if (nodeCount <= 40) return 0;
  if (scale >= 1.6) return 0;
  if (scale >= 1.0) return 2;
  if (scale >= 0.6) return 5;
  return Infinity;
}

function readPalette(host: HTMLElement): Palette {
  const style = getComputedStyle(host);
  const get = (name: string, fallback: string): string => {
    const v = style.getPropertyValue(name).trim();
    return v === '' ? fallback : v;
  };
  return {
    bg: get('--bg', '#1b1b1f'),
    link: get('--border', '#2e2e35'),
    node: get('--accent', '#a78bfa'),
    nodeDim: get('--fg-faint', '#62626b'),
    unresolved: get('--unresolved', '#e0956b'),
    accent: get('--accent', '#a78bfa'),
    label: get('--fg', '#dcddde'),
    labelDim: get('--fg-dim', '#8b8b93'),
  };
}

export { isUnresolvedId };

/** 保存通知だけで同じグラフの Worker を起動し直さない。 */
function sameGraph(a: GraphData, b: GraphData): boolean {
  return a.nodes.length === b.nodes.length && a.links.length === b.links.length
    && a.nodes.every((n, i) => {
      const other = b.nodes[i]!;
      return n.id === other.id && n.label === other.label && n.kind === other.kind && n.degree === other.degree;
    })
    && a.links.every((l, i) => l.source === b.links[i]!.source && l.target === b.links[i]!.target);
}
