import { newCanvasId } from '../../core/canvas/parse';
import {
  CANVAS_SIDES,
  DEFAULT_NODE_SIZE,
  emptyCanvas,
  type CanvasData,
  type CanvasEdge,
  type CanvasNode,
  type CanvasSide,
} from '../../core/canvas/types';
import { el } from '../dom';

export interface CanvasViewOptions {
  /** 中身が変わった。保存は呼び出し側の自動保存に任せる。 */
  onChange?: (data: CanvasData) => void;
  /** file ノードを開く。 */
  onOpenFile: (file: string, subpath?: string) => void;
  /** file ノードの中身。表示できなければ null。 */
  loadFile?: (file: string, subpath?: string) => Promise<string | null>;
}

interface Drag {
  kind: 'pan' | 'move' | 'resize' | 'connect';
  pointerId: number;
  startX: number;
  startY: number;
  node?: CanvasNode;
  origin?: { x: number; y: number; width: number; height: number };
  fromSide?: CanvasSide;
}

const MIN_SIZE = 60;
const ZOOM_RANGE = { min: 0.2, max: 3 };

/**
 * `.canvas` の編集画面。
 *
 * グラフビューと違って **DOM で描く**。
 * テキスト入力・選択・IME を扱うので、Canvas 2D より DOM のほうが素直なため
 * （設計書 §12 / PHASE5.md 5.5）。
 * パンとズームは、ノードを載せた層に transform を掛けて表現する。
 */
export class CanvasView {
  readonly dom: HTMLElement;
  private readonly world: HTMLElement;
  private readonly edgeLayer: SVGSVGElement;
  private readonly nodeLayer: HTMLElement;
  private readonly hint: HTMLElement;

  private data: CanvasData = emptyCanvas();
  /** 開いている .canvas ごとに差し替える受け取り先。 */
  private listener: ((data: CanvasData) => void) | null = null;
  private scale = 1;
  private offset = { x: 0, y: 0 };
  private selected: string | null = null;
  private drag: Drag | null = null;
  private editing: string | null = null;

  constructor(private readonly opts: CanvasViewOptions) {
    this.dom = el('div', 'canvas-view');
    this.dom.tabIndex = 0;

    this.world = el('div', 'canvas-world');
    this.edgeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.edgeLayer.setAttribute('class', 'canvas-edges');
    this.nodeLayer = el('div', 'canvas-nodes');
    this.world.append(this.edgeLayer, this.nodeLayer);

    this.hint = el('div', 'canvas-hint', '背景をダブルクリックでカードを作成／ドラッグで移動／ホイールで拡大縮小');
    this.dom.append(this.world, this.hint);

    this.dom.addEventListener('pointerdown', (event) => this.onBackgroundPointerDown(event));
    this.dom.addEventListener('pointermove', (event) => this.onPointerMove(event));
    this.dom.addEventListener('pointerup', (event) => this.endDrag(event));
    this.dom.addEventListener('pointercancel', (event) => this.endDrag(event));
    this.dom.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    this.dom.addEventListener('dblclick', (event) => this.onDoubleClick(event));
    this.dom.addEventListener('keydown', (event) => this.onKeyDown(event));
  }

  /** 変更の受け取り先を差し替える。null で外す（別の文書へ移るとき）。 */
  bind(listener: ((data: CanvasData) => void) | null): void {
    this.listener = listener;
  }

  setData(data: CanvasData): void {
    this.data = data;
    this.selected = null;
    this.editing = null;
    this.render();
  }

  getData(): CanvasData {
    return this.data;
  }

  /** 画面の中身をすべて収める。開いた直後に呼ぶ。 */
  fit(): void {
    if (this.data.nodes.length === 0) {
      this.scale = 1;
      this.offset = { x: 40, y: 40 };
      this.applyTransform();
      return;
    }

    const minX = Math.min(...this.data.nodes.map((node) => node.x));
    const minY = Math.min(...this.data.nodes.map((node) => node.y));
    const maxX = Math.max(...this.data.nodes.map((node) => node.x + node.width));
    const maxY = Math.max(...this.data.nodes.map((node) => node.y + node.height));

    const width = this.dom.clientWidth || 800;
    const height = this.dom.clientHeight || 600;
    const scale = Math.min(1, (width - 80) / Math.max(1, maxX - minX), (height - 80) / Math.max(1, maxY - minY));
    this.scale = clamp(scale, ZOOM_RANGE.min, ZOOM_RANGE.max);
    this.offset = {
      x: (width - (maxX - minX) * this.scale) / 2 - minX * this.scale,
      y: (height - (maxY - minY) * this.scale) / 2 - minY * this.scale,
    };
    this.applyTransform();
  }

  // ------------------------------------------------------------- 変更

  private commit(): void {
    this.render();
    this.emit();
  }

  private emit(): void {
    (this.listener ?? this.opts.onChange)?.(this.data);
  }

  private takenIds(): Set<string> {
    return new Set([...this.data.nodes.map((n) => n.id), ...this.data.edges.map((e) => e.id)]);
  }

  addTextNode(x: number, y: number): CanvasNode {
    const node: CanvasNode = {
      id: newCanvasId(this.takenIds()),
      type: 'text',
      x: Math.round(x - DEFAULT_NODE_SIZE.width / 2),
      y: Math.round(y - DEFAULT_NODE_SIZE.height / 2),
      width: DEFAULT_NODE_SIZE.width,
      height: DEFAULT_NODE_SIZE.height,
      text: '',
    };
    this.data = { ...this.data, nodes: [...this.data.nodes, node] };
    this.selected = node.id;
    this.editing = node.id;
    this.commit();
    this.focusEditor(node.id);
    return node;
  }

  /** ファイルを置く。ドロップやコマンドから使う。 */
  addFileNode(file: string, x: number, y: number): CanvasNode {
    const node: CanvasNode = {
      id: newCanvasId(this.takenIds()),
      type: 'file',
      x: Math.round(x),
      y: Math.round(y),
      width: 300,
      height: 200,
      file,
    };
    this.data = { ...this.data, nodes: [...this.data.nodes, node] };
    this.selected = node.id;
    this.commit();
    return node;
  }

  private removeSelected(): void {
    const id = this.selected;
    if (id === null) return;
    this.data = {
      ...this.data,
      nodes: this.data.nodes.filter((node) => node.id !== id),
      // 端が消えた辺は残せない。
      edges: this.data.edges.filter((edge) => edge.fromNode !== id && edge.toNode !== id),
    };
    this.selected = null;
    this.editing = null;
    this.commit();
  }

  private connect(from: CanvasNode, fromSide: CanvasSide, to: CanvasNode, toSide: CanvasSide): void {
    if (from.id === to.id) return;
    const exists = this.data.edges.some(
      (edge) => edge.fromNode === from.id && edge.toNode === to.id,
    );
    if (exists) return;

    const edge: CanvasEdge = {
      id: newCanvasId(this.takenIds()),
      fromNode: from.id,
      fromSide,
      toNode: to.id,
      toSide,
    };
    this.data = { ...this.data, edges: [...this.data.edges, edge] };
    this.commit();
  }

  private updateNode(id: string, patch: Partial<CanvasNode>): void {
    this.data = {
      ...this.data,
      nodes: this.data.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
    };
  }

  // ------------------------------------------------------------- 入力

  private toWorld(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.dom.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - this.offset.x) / this.scale,
      y: (event.clientY - rect.top - this.offset.y) / this.scale,
    };
  }

  private onBackgroundPointerDown(event: PointerEvent): void {
    if (event.target !== this.dom && event.target !== this.world && event.target !== this.nodeLayer) return;
    this.selected = null;
    this.editing = null;
    this.render();
    this.drag = { kind: 'pan', pointerId: event.pointerId, startX: event.clientX - this.offset.x, startY: event.clientY - this.offset.y };
    this.dom.setPointerCapture(event.pointerId);
  }

  private onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (drag.kind === 'pan') {
      this.offset = { x: event.clientX - drag.startX, y: event.clientY - drag.startY };
      this.applyTransform();
      return;
    }

    const node = drag.node;
    const origin = drag.origin;
    if (!node || !origin) return;

    const dx = (event.clientX - drag.startX) / this.scale;
    const dy = (event.clientY - drag.startY) / this.scale;

    if (drag.kind === 'move') {
      this.updateNode(node.id, { x: Math.round(origin.x + dx), y: Math.round(origin.y + dy) });
      this.render();
      return;
    }
    if (drag.kind === 'resize') {
      this.updateNode(node.id, {
        width: Math.round(Math.max(MIN_SIZE, origin.width + dx)),
        height: Math.round(Math.max(MIN_SIZE, origin.height + dy)),
      });
      this.render();
    }
  }

  private endDrag(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.drag = null;
    if (this.dom.hasPointerCapture(event.pointerId)) this.dom.releasePointerCapture(event.pointerId);

    if (drag.kind === 'connect' && drag.node && drag.fromSide) {
      const target = this.nodeAt(this.toWorld(event));
      if (target && target.id !== drag.node.id) {
        this.connect(drag.node, drag.fromSide, target, opposite(drag.fromSide));
      }
      this.render();
      return;
    }
    if (drag.kind === 'move' || drag.kind === 'resize') this.commit();
  }

  private nodeAt(point: { x: number; y: number }): CanvasNode | null {
    // 手前に描いたものを先に拾う。
    for (let i = this.data.nodes.length - 1; i >= 0; i--) {
      const node = this.data.nodes[i]!;
      if (
        point.x >= node.x && point.x <= node.x + node.width &&
        point.y >= node.y && point.y <= node.y + node.height
      ) {
        return node;
      }
    }
    return null;
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    const rect = this.dom.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const before = this.toWorld(event);

    this.scale = clamp(this.scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1), ZOOM_RANGE.min, ZOOM_RANGE.max);
    // ポインタの下にある点が動かないように、原点をずらす。
    this.offset = { x: px - before.x * this.scale, y: py - before.y * this.scale };
    this.applyTransform();
  }

  private onDoubleClick(event: MouseEvent): void {
    if (event.target !== this.dom && event.target !== this.world && event.target !== this.nodeLayer) return;
    const point = this.toWorld(event);
    this.addTextNode(point.x, point.y);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.editing !== null) return;
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    if (this.selected === null) return;
    event.preventDefault();
    this.removeSelected();
  }

  private focusEditor(id: string): void {
    const area = this.nodeLayer.querySelector<HTMLTextAreaElement>(`[data-node="${id}"] textarea`);
    area?.focus();
  }

  // ------------------------------------------------------------- 描画

  private applyTransform(): void {
    this.world.style.transform = `translate(${this.offset.x}px, ${this.offset.y}px) scale(${this.scale})`;
  }

  private render(): void {
    this.applyTransform();
    this.nodeLayer.replaceChildren();
    for (const node of this.data.nodes) this.nodeLayer.append(this.renderNode(node));
    this.renderEdges();
    this.hint.style.display = this.data.nodes.length === 0 ? '' : 'none';
  }

  private renderNode(node: CanvasNode): HTMLElement {
    const box = el('div', `canvas-node canvas-node-${node.type}`);
    box.dataset['node'] = node.id;
    box.style.left = `${node.x}px`;
    box.style.top = `${node.y}px`;
    box.style.width = `${node.width}px`;
    box.style.height = `${node.height}px`;
    if (node.color) box.style.setProperty('--node-color', node.color);
    if (node.id === this.selected) box.classList.add('selected');

    box.addEventListener('pointerdown', (event) => {
      if (event.target instanceof HTMLTextAreaElement) return;
      event.stopPropagation();
      this.selected = node.id;
      if (this.editing !== node.id) this.editing = null;
      this.render();
      this.drag = {
        kind: 'move',
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        node,
        origin: { x: node.x, y: node.y, width: node.width, height: node.height },
      };
      this.dom.setPointerCapture(event.pointerId);
    });

    box.append(this.renderBody(node));

    const resize = el('div', 'canvas-resize');
    resize.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      this.selected = node.id;
      this.drag = {
        kind: 'resize',
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        node,
        origin: { x: node.x, y: node.y, width: node.width, height: node.height },
      };
      this.dom.setPointerCapture(event.pointerId);
    });
    box.append(resize);

    for (const side of CANVAS_SIDES) {
      const handle = el('div', `canvas-port canvas-port-${side}`);
      handle.title = 'ドラッグして他のカードへつなぐ';
      handle.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        this.selected = node.id;
        this.drag = {
          kind: 'connect',
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          node,
          fromSide: side,
        };
        this.dom.setPointerCapture(event.pointerId);
      });
      box.append(handle);
    }

    return box;
  }

  private renderBody(node: CanvasNode): HTMLElement {
    if (node.type === 'text') {
      const area = el('textarea', 'canvas-text');
      area.value = node.text ?? '';
      area.placeholder = 'ここに書く';
      area.addEventListener('focus', () => {
        this.editing = node.id;
      });
      area.addEventListener('blur', () => {
        if (this.editing === node.id) this.editing = null;
      });
      area.addEventListener('input', () => {
        this.updateNode(node.id, { text: area.value });
        this.emit();
      });
      return area;
    }

    if (node.type === 'file') {
      const wrap = el('div', 'canvas-file');
      const title = el('button', 'canvas-file-title');
      title.type = 'button';
      title.textContent = `${node.file ?? ''}${node.subpath ?? ''}`;
      title.addEventListener('click', (event) => {
        event.stopPropagation();
        if (node.file) this.opts.onOpenFile(node.file, node.subpath);
      });
      const body = el('div', 'canvas-file-body', '読み込み中…');
      wrap.append(title, body);

      void this.opts.loadFile?.(node.file ?? '', node.subpath).then((text) => {
        if (!body.isConnected) return;
        body.textContent = text ?? '（このファイルは表示できません）';
      });
      return wrap;
    }

    if (node.type === 'link') {
      const link = el('div', 'canvas-link');
      link.textContent = node.url ?? '';
      link.title = node.url ?? '';
      return link;
    }

    const label = el('div', 'canvas-group-label', node.label ?? '');
    return label;
  }

  private renderEdges(): void {
    this.edgeLayer.replaceChildren();
    if (this.data.nodes.length === 0) return;

    const byId = new Map(this.data.nodes.map((node) => [node.id, node]));
    const minX = Math.min(...this.data.nodes.map((node) => node.x)) - 200;
    const minY = Math.min(...this.data.nodes.map((node) => node.y)) - 200;
    const maxX = Math.max(...this.data.nodes.map((node) => node.x + node.width)) + 200;
    const maxY = Math.max(...this.data.nodes.map((node) => node.y + node.height)) + 200;

    this.edgeLayer.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
    this.edgeLayer.style.left = `${minX}px`;
    this.edgeLayer.style.top = `${minY}px`;
    this.edgeLayer.style.width = `${maxX - minX}px`;
    this.edgeLayer.style.height = `${maxY - minY}px`;

    for (const edge of this.data.edges) {
      const from = byId.get(edge.fromNode);
      const to = byId.get(edge.toNode);
      if (!from || !to) continue;

      const a = anchor(from, edge.fromSide);
      const b = anchor(to, edge.toSide);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      line.setAttribute('d', curve(a, b, edge.fromSide, edge.toSide));
      line.setAttribute('class', 'canvas-edge');
      if (edge.color) line.style.stroke = edge.color;
      this.edgeLayer.append(line);
    }
  }
}

function anchor(node: CanvasNode, side: CanvasSide): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: node.x + node.width / 2, y: node.y };
    case 'bottom':
      return { x: node.x + node.width / 2, y: node.y + node.height };
    case 'left':
      return { x: node.x, y: node.y + node.height / 2 };
    case 'right':
      return { x: node.x + node.width, y: node.y + node.height / 2 };
  }
}

/** 辺は、出入りする向きへ一度伸ばしてから曲げる。 */
function curve(
  a: { x: number; y: number },
  b: { x: number; y: number },
  fromSide: CanvasSide,
  toSide: CanvasSide,
): string {
  const reach = Math.max(40, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2);
  const c1 = push(a, fromSide, reach);
  const c2 = push(b, toSide, reach);
  return `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`;
}

function push(point: { x: number; y: number }, side: CanvasSide, by: number): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: point.x, y: point.y - by };
    case 'bottom':
      return { x: point.x, y: point.y + by };
    case 'left':
      return { x: point.x - by, y: point.y };
    case 'right':
      return { x: point.x + by, y: point.y };
  }
}

function opposite(side: CanvasSide): CanvasSide {
  switch (side) {
    case 'top':
      return 'bottom';
    case 'bottom':
      return 'top';
    case 'left':
      return 'right';
    case 'right':
      return 'left';
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
