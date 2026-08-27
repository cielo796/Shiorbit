import { basename } from './path';
import type { VPath } from './types';

/**
 * 競合したときの退避ファイル（設計書 §9）。
 *
 *   AI/Ollama.md → AI/Ollama.conflict-20260827-1530.md
 *
 * 名前だけで見分けられるようにしてあるので、一覧も片付けも走査1回で済む。
 */
const CONFLICT_MARK = /\.conflict-(\d{8}-\d{4,6})(?=\.|$)/;

export function conflictPathFor(path: VPath, stamp: string): VPath {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  return dot > slash + 1
    ? `${path.slice(0, dot)}.conflict-${stamp}${path.slice(dot)}`
    : `${path}.conflict-${stamp}`;
}

export function isConflictCopy(path: VPath): boolean {
  return CONFLICT_MARK.test(basename(path));
}

/** 退避元のパス。競合ファイルでなければ null。 */
export function originalOfConflict(path: VPath): VPath | null {
  const name = basename(path);
  if (!CONFLICT_MARK.test(name)) return null;
  return path.replace(CONFLICT_MARK, '');
}

/** 退避した時刻の表示用。読めない形なら空文字。 */
export function conflictStamp(path: VPath): string {
  return CONFLICT_MARK.exec(basename(path))?.[1] ?? '';
}

export function formatConflictStamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}`
  );
}
