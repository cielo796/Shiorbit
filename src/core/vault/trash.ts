import { join, segments } from './path';
import type { VPath } from './types';

/**
 * ごみ箱。Vault の中の隠しフォルダなので、
 * ツリーにもインデックスにも自動で出てこない（`isHidden` が既に効く）。
 */
export const TRASH_DIR = '.trash';

export interface TrashEntry {
  /** ごみ箱の中の実際の場所 */
  path: VPath;
  /** 削除する前の場所。ここへ戻す。 */
  original: VPath;
  /** 削除した時刻（同じ場所を2回消しても別の山になる） */
  stamp: string;
  kind: 'file' | 'dir';
}

/**
 * 消したものは `.trash/<時刻>_<元のパスを符号化したもの>` に置く。
 *
 *   AI/Ollama.md → .trash/20260827-153012_AI%2FOllama.md
 *
 * 元の階層をそのまま作り直す方式だと、途中に作った空フォルダと
 * 「消したもの」の区別が付かなくなる（`AI/` を消したのか `AI/x.md` を消したのか）。
 * 名前に元のパスを入れておけば、戻す先が一意に決まり、
 * 一覧も `.trash` の直下を見るだけで済む。
 */
export function trashRootName(stamp: string, original: VPath): string {
  return `${stamp}_${encodeURIComponent(original)}`;
}

export function trashPathFor(stamp: string, original: VPath): VPath {
  return join(TRASH_DIR, trashRootName(stamp, original));
}

/** `.trash` 直下の名前を分解する。形が違えば null。 */
export function parseTrashRoot(name: string): { stamp: string; original: VPath } | null {
  const at = name.indexOf('_');
  if (at <= 0) return null;
  const original = safeDecode(name.slice(at + 1));
  return original === '' ? null : { stamp: name.slice(0, at), original };
}

/** ごみ箱の中のパスから、元の場所を求める。ごみ箱の外なら null。 */
export function originalPathOf(trashed: VPath): VPath | null {
  const parts = segments(trashed);
  if (parts.length < 2 || parts[0] !== TRASH_DIR) return null;
  const root = parseTrashRoot(parts[1] ?? '');
  if (root === null) return null;
  // 山の中のファイルは、消したフォルダからの相対位置をそのまま保つ。
  return join(root.original, ...parts.slice(2));
}

export function isInTrash(path: VPath): boolean {
  return segments(path)[0] === TRASH_DIR;
}

/** 秒まで入れる。同じ分に2回消しても山が混ざらないようにするため。 */
export function formatTrashStamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/** 同じ秒に同じ場所を2回消したときのために、空いている名前を選ぶ。 */
export function freeStamp(base: string, original: VPath, taken: ReadonlySet<string>): string {
  if (!taken.has(trashRootName(base, original))) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(trashRootName(candidate, original))) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/**
 * ごみ箱の一覧。`.trash` の直下がそのまま「戻す単位」になる。
 * 中身をすべて並べても選べないので、消したときの単位に合わせる。
 */
export function collectTrashEntries(
  entries: readonly { path: VPath; kind: 'file' | 'dir' }[],
): TrashEntry[] {
  const out: TrashEntry[] = [];

  for (const entry of entries) {
    const parts = segments(entry.path);
    // 直下だけを見る。山の中身は戻す単位ではない。
    if (parts.length !== 2 || parts[0] !== TRASH_DIR) continue;
    const root = parseTrashRoot(parts[1] ?? '');
    if (root === null) continue;
    out.push({ path: entry.path, original: root.original, stamp: root.stamp, kind: entry.kind });
  }

  return out.sort((a, b) => b.stamp.localeCompare(a.stamp));
}

/** 壊れた名前でも一覧を落とさない。 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
