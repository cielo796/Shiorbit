/**
 * `.canvas` のデータ構造。Obsidian の JSON 形式に合わせる。
 *
 * 知らないキーは `extra` に取っておき、書き戻すときに混ぜ直す。
 * Obsidian が付けた色やスタイルを、こちらで開いただけで消さないため。
 */
export type CanvasNodeType = 'text' | 'file' | 'link' | 'group';

export type CanvasSide = 'top' | 'right' | 'bottom' | 'left';

export const CANVAS_SIDES: readonly CanvasSide[] = ['top', 'right', 'bottom', 'left'];

export interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  /** type === 'text' */
  text?: string;
  /** type === 'file' — Vault 内のパス */
  file?: string;
  /** type === 'file' — "#見出し" など */
  subpath?: string;
  /** type === 'link' */
  url?: string;
  /** type === 'group' */
  label?: string;
  color?: string;
  extra?: Record<string, unknown>;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide: CanvasSide;
  toNode: string;
  toSide: CanvasSide;
  label?: string;
  color?: string;
  extra?: Record<string, unknown>;
}

export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  extra?: Record<string, unknown>;
}

export const DEFAULT_NODE_SIZE = { width: 260, height: 120 } as const;

export function emptyCanvas(): CanvasData {
  return { nodes: [], edges: [] };
}
