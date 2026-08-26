import {
  CANVAS_SIDES,
  DEFAULT_NODE_SIZE,
  emptyCanvas,
  type CanvasData,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeType,
  type CanvasSide,
} from './types';

const NODE_KEYS = new Set([
  'id', 'type', 'x', 'y', 'width', 'height', 'text', 'file', 'subpath', 'url', 'label', 'color',
]);
const EDGE_KEYS = new Set(['id', 'fromNode', 'fromSide', 'toNode', 'toSide', 'label', 'color']);
const NODE_TYPES: readonly CanvasNodeType[] = ['text', 'file', 'link', 'group'];

/**
 * `.canvas` を読む。
 *
 * 壊れた JSON でも例外を投げず、空のキャンバスを返す。
 * 中身が読めないからといって、利用者のファイルを上書きしてはいけないので、
 * 「開けなかった」は呼び出し側が isBroken で判断できるようにしてある。
 */
export function parseCanvas(text: string): CanvasData {
  const raw = safeParse(text);
  if (raw === null) return emptyCanvas();

  const nodes: CanvasNode[] = [];
  for (const item of asArray(raw['nodes'])) {
    const node = toNode(item);
    if (node !== null) nodes.push(node);
  }

  const ids = new Set(nodes.map((node) => node.id));
  const edges: CanvasEdge[] = [];
  for (const item of asArray(raw['edges'])) {
    const edge = toEdge(item);
    // 端が無い辺は描けないので落とす。
    if (edge !== null && ids.has(edge.fromNode) && ids.has(edge.toNode)) edges.push(edge);
  }

  const extra = rest(raw, new Set(['nodes', 'edges']));
  return { nodes, edges, ...(extra ? { extra } : {}) };
}

/** JSON として読めるか。空文字は「これから書く」とみなして true。 */
export function isCanvasReadable(text: string): boolean {
  return text.trim() === '' || safeParse(text) !== null;
}

export function stringifyCanvas(data: CanvasData): string {
  const nodes = data.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    ...(node.type === 'file' ? { file: node.file ?? '' } : {}),
    ...(node.subpath !== undefined ? { subpath: node.subpath } : {}),
    ...(node.type === 'text' ? { text: node.text ?? '' } : {}),
    ...(node.type === 'link' ? { url: node.url ?? '' } : {}),
    ...(node.label !== undefined ? { label: node.label } : {}),
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    ...(node.color !== undefined ? { color: node.color } : {}),
    ...node.extra,
  }));

  const edges = data.edges.map((edge) => ({
    id: edge.id,
    fromNode: edge.fromNode,
    fromSide: edge.fromSide,
    toNode: edge.toNode,
    toSide: edge.toSide,
    ...(edge.label !== undefined ? { label: edge.label } : {}),
    ...(edge.color !== undefined ? { color: edge.color } : {}),
    ...edge.extra,
  }));

  return `${JSON.stringify({ ...data.extra, nodes, edges }, null, 2)}\n`;
}

/** 既存と衝突しない短い id。Obsidian も16桁の英数字を使う。 */
export function newCanvasId(taken: ReadonlySet<string>): string {
  for (let i = 0; i < 1000; i++) {
    const id = Math.random().toString(16).slice(2, 18).padEnd(16, '0');
    if (!taken.has(id)) return id;
  }
  return `${Date.now().toString(16)}${taken.size.toString(16)}`;
}

// ------------------------------------------------------------------ 変換

function toNode(item: unknown): CanvasNode | null {
  if (!isRecord(item)) return null;
  const id = asString(item['id']);
  if (id === undefined) return null;

  const type = asString(item['type']) ?? 'text';
  if (!isNodeType(type)) return null;

  const extra = rest(item, NODE_KEYS);
  return {
    id,
    type,
    x: asNumber(item['x']) ?? 0,
    y: asNumber(item['y']) ?? 0,
    width: asNumber(item['width']) ?? DEFAULT_NODE_SIZE.width,
    height: asNumber(item['height']) ?? DEFAULT_NODE_SIZE.height,
    ...(asString(item['text']) !== undefined || type === 'text'
      ? { text: typeof item['text'] === 'string' ? item['text'] : '' }
      : {}),
    ...(asString(item['file']) !== undefined ? { file: asString(item['file'])! } : {}),
    ...(asString(item['subpath']) !== undefined ? { subpath: asString(item['subpath'])! } : {}),
    ...(asString(item['url']) !== undefined ? { url: asString(item['url'])! } : {}),
    ...(asString(item['label']) !== undefined ? { label: asString(item['label'])! } : {}),
    ...(asString(item['color']) !== undefined ? { color: asString(item['color'])! } : {}),
    ...(extra ? { extra } : {}),
  };
}

function toEdge(item: unknown): CanvasEdge | null {
  if (!isRecord(item)) return null;
  const id = asString(item['id']);
  const fromNode = asString(item['fromNode']);
  const toNode_ = asString(item['toNode']);
  if (id === undefined || fromNode === undefined || toNode_ === undefined) return null;

  const extra = rest(item, EDGE_KEYS);
  return {
    id,
    fromNode,
    fromSide: asSide(item['fromSide']) ?? 'right',
    toNode: toNode_,
    toSide: asSide(item['toSide']) ?? 'left',
    ...(asString(item['label']) !== undefined ? { label: asString(item['label'])! } : {}),
    ...(asString(item['color']) !== undefined ? { color: asString(item['color'])! } : {}),
    ...(extra ? { extra } : {}),
  };
}

function safeParse(text: string): Record<string, unknown> | null {
  if (text.trim() === '') return {};
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/** 知っているキー以外を集める。空なら undefined（JSON に余計な {} を出さないため）。 */
function rest(item: Record<string, unknown>, known: ReadonlySet<string>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  let found = false;
  for (const [key, value] of Object.entries(item)) {
    if (known.has(key)) continue;
    out[key] = value;
    found = true;
  }
  return found ? out : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asSide(value: unknown): CanvasSide | undefined {
  const side = asString(value);
  return side !== undefined && (CANVAS_SIDES as readonly string[]).includes(side)
    ? (side as CanvasSide)
    : undefined;
}

function isNodeType(value: string): value is CanvasNodeType {
  return (NODE_TYPES as readonly string[]).includes(value);
}
