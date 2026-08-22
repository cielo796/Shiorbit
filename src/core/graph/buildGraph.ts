import {
  emptyGraph,
  unresolvedId,
  type GraphData,
  type GraphInput,
  type GraphLink,
  type GraphNode,
} from './types';

export interface BuildOptions {
  /** 未解決リンク（まだ存在しないノート）もノードとして出す */
  includeUnresolved?: boolean;
  /** ノード名の絞り込み（小文字で部分一致） */
  query?: string;
  /**
   * 起点から depth ホップ以内だけを取り出す（ローカルグラフ）。
   * 省略すると Vault 全体。
   */
  focus?: { id: string; depth: number };
  /** 安全弁。これを超えたら次数の高い順に切り詰める。 */
  maxNodes?: number;
}

/**
 * リンク構造からグラフを組み立てる純粋関数。
 *
 * 描画も DOM も知らないので、Node 環境でそのままテストできる。
 * リンクの向きは残さず無向グラフとして扱う（相互参照も1本にまとめる）。
 */
export function buildGraph(input: GraphInput[], options: BuildOptions = {}): GraphData {
  const { includeUnresolved = false, query, focus, maxNodes = 3000 } = options;
  if (input.length === 0) return emptyGraph();

  const labels = new Map<string, string>();
  const kinds = new Map<string, GraphNode['kind']>();
  const adjacency = new Map<string, Set<string>>();

  const touch = (id: string, label: string, kind: GraphNode['kind']): void => {
    if (!labels.has(id)) {
      labels.set(id, label);
      kinds.set(id, kind);
      adjacency.set(id, new Set());
    }
  };

  for (const note of input) touch(note.path, note.basename, 'note');

  for (const note of input) {
    for (const link of note.links) {
      let other: string;
      if (link.resolved !== null) {
        if (link.resolved === note.path) continue;
        if (!labels.has(link.resolved)) continue;
        other = link.resolved;
      } else {
        if (!includeUnresolved) continue;
        if (link.target === '') continue;
        other = unresolvedId(link.target);
        touch(other, link.target, 'unresolved');
      }
      adjacency.get(note.path)?.add(other);
      adjacency.get(other)?.add(note.path);
    }
  }

  let ids = [...labels.keys()];

  // --- フォーカス（ローカルグラフ）: 幅優先で depth ホップまで辿る
  if (focus && labels.has(focus.id)) {
    const seen = new Set<string>([focus.id]);
    let frontier = [focus.id];
    for (let d = 0; d < Math.max(0, focus.depth); d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const neighbor of adjacency.get(id) ?? []) {
          if (seen.has(neighbor)) continue;
          seen.add(neighbor);
          next.push(neighbor);
        }
      }
      if (next.length === 0) break;
      frontier = next;
    }
    ids = ids.filter((id) => seen.has(id));
  } else if (focus) {
    return emptyGraph();
  }

  // --- 名前での絞り込み（一致したノードとその隣接だけ残す）
  if (query && query.trim() !== '') {
    const q = query.trim().toLowerCase();
    const hit = new Set(ids.filter((id) => (labels.get(id) ?? '').toLowerCase().includes(q)));
    const keep = new Set(hit);
    for (const id of hit) {
      for (const neighbor of adjacency.get(id) ?? []) keep.add(neighbor);
    }
    ids = ids.filter((id) => keep.has(id));
  }

  const alive = new Set(ids);

  // --- 上限を超えたら次数の高い順に残す
  if (alive.size > maxNodes) {
    const ranked = [...alive].sort(
      (a, b) =>
        degreeWithin(adjacency, b, alive) - degreeWithin(adjacency, a, alive) ||
        a.localeCompare(b), // 同順位のときも結果がぶれないように
    );
    alive.clear();
    for (const id of ranked.slice(0, maxNodes)) alive.add(id);
  }

  const nodes: GraphNode[] = [];
  for (const id of alive) {
    nodes.push({
      id,
      label: labels.get(id) ?? id,
      kind: kinds.get(id) ?? 'note',
      degree: degreeWithin(adjacency, id, alive),
    });
  }
  nodes.sort((a, b) => a.id.localeCompare(b.id));

  const links: GraphLink[] = [];
  const emitted = new Set<string>();
  for (const id of alive) {
    for (const neighbor of adjacency.get(id) ?? []) {
      if (!alive.has(neighbor)) continue;
      const key = id < neighbor ? `${id} ${neighbor}` : `${neighbor} ${id}`;
      if (emitted.has(key)) continue;
      emitted.add(key);
      links.push(id < neighbor ? { source: id, target: neighbor } : { source: neighbor, target: id });
    }
  }
  links.sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));

  return { nodes, links };
}

function degreeWithin(adjacency: Map<string, Set<string>>, id: string, alive: Set<string>): number {
  let n = 0;
  for (const neighbor of adjacency.get(id) ?? []) if (alive.has(neighbor)) n++;
  return n;
}
