import type { VPath } from '../vault/types';
import { dirname, normalize, segments } from '../vault/path';

export interface ResolveTables {
  /** 正規化した実在パス (小文字) -> 実際の VPath */
  byPath: Map<string, VPath>;
  /** basename (小文字) -> 候補パス */
  byBasename: Map<string, VPath[]>;
  /** frontmatter の別名 (小文字) -> 候補パス */
  byAlias: Map<string, VPath[]>;
}

export function emptyTables(): ResolveTables {
  return { byPath: new Map(), byBasename: new Map(), byAlias: new Map() };
}

/**
 * リンク解決 (設計書 §5)
 *
 *   1. 完全一致パス
 *   2. basename がちょうど1件一致
 *   3. 複数一致 → リンク元からのパス距離が最短
 *   4. どれも無い → null (未解決リンク)
 *
 * Obsidian と同じく大文字小文字は区別しない。
 */
export function resolveLink(target: string, from: VPath, tables: ResolveTables): VPath | null {
  const raw = normalize(target).replace(/\.md$/i, '');
  if (raw === '') return null;
  const key = raw.toLowerCase();

  // 1. 完全一致パス
  const exact = tables.byPath.get(key);
  if (exact !== undefined) return exact;

  // パス付きで指定されている場合、basename 一致は使わない
  if (key.includes('/')) return null;

  // 2 & 3. basename 一致
  const byName = tables.byBasename.get(key);
  if (byName && byName.length > 0) return pickNearest(byName, from);

  // 補助: frontmatter の別名
  const byAlias = tables.byAlias.get(key);
  if (byAlias && byAlias.length > 0) return pickNearest(byAlias, from);

  return null;
}

/** 候補が複数あるときは、リンク元にいちばん近いものを選ぶ */
export function pickNearest(candidates: readonly VPath[], from: VPath): VPath {
  let best = candidates[0]!;
  let bestScore = score(best, from);
  for (let i = 1; i < candidates.length; i++) {
    const s = score(candidates[i]!, from);
    if (
      s.distance < bestScore.distance ||
      (s.distance === bestScore.distance && s.depth < bestScore.depth) ||
      (s.distance === bestScore.distance && s.depth === bestScore.depth && candidates[i]! < best)
    ) {
      best = candidates[i]!;
      bestScore = s;
    }
  }
  return best;
}

function score(candidate: VPath, from: VPath): { distance: number; depth: number } {
  const a = segments(dirname(from));
  const b = segments(dirname(candidate));
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) common++;
  return { distance: a.length - common + (b.length - common), depth: b.length };
}
