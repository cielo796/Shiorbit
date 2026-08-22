import type { VPath } from '../vault/types';

/** 未解決リンクのノード ID。実在するノートのパスと衝突しないよう接頭辞を付ける。 */
export const UNRESOLVED_PREFIX = 'unresolved:';

export function unresolvedId(name: string): string {
  return `${UNRESOLVED_PREFIX}${name.toLowerCase()}`;
}

export function isUnresolvedId(id: string): boolean {
  return id.startsWith(UNRESOLVED_PREFIX);
}

export interface GraphNode {
  /** ノートなら VPath、未解決リンクなら "unresolved:名前" */
  id: string;
  label: string;
  kind: 'note' | 'unresolved';
  /** つながっている本数。円の大きさに使う。 */
  degree: number;
}

export interface GraphLink {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

/** レイアウト計算の結果 */
export interface Positions {
  ids: string[];
  xs: Float32Array;
  ys: Float32Array;
}

export function emptyGraph(): GraphData {
  return { nodes: [], links: [] };
}

/** グラフ構築の入力。Indexer から取り出した最小限の情報。 */
export interface GraphInput {
  path: VPath;
  basename: string;
  links: { target: string; resolved: VPath | null }[];
}
