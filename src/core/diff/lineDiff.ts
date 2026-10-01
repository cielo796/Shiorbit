/**
 * 行単位の差分。
 *
 * 競合したときに「中身を見てから選ぶ」ためだけに使うので、
 * 最短編集距離を厳密に求める必要はない。
 * 前後の一致行を削ってから中央を LCS で突き合わせる、素直な実装にしてある
 * （依存を増やさず、Node のテストで全経路を確かめられる形を優先）。
 */
export type DiffKind = 'same' | 'added' | 'removed';

export interface DiffLine {
  kind: DiffKind;
  text: string;
  /** 元テキストの行番号（1始まり）。追加行は undefined。 */
  leftLine?: number;
  /** 相手テキストの行番号（1始まり）。削除行は undefined。 */
  rightLine?: number;
}

export interface DiffStats {
  added: number;
  removed: number;
}

/** 大きなファイルで LCS の表が膨らみすぎないための上限。 */
const MAX_CELLS = 4_000_000;

export function diffLines(left: string, right: string): DiffLine[] {
  const a = splitLines(left);
  const b = splitLines(right);

  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;

  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }

  const out: DiffLine[] = [];
  for (let i = 0; i < head; i++) {
    out.push({ kind: 'same', text: a[i]!, leftLine: i + 1, rightLine: i + 1 });
  }

  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  out.push(...diffMiddle(midA, midB, head));

  for (let i = 0; i < tail; i++) {
    const index = a.length - tail + i;
    out.push({
      kind: 'same',
      text: a[index]!,
      leftLine: index + 1,
      rightLine: b.length - tail + i + 1,
    });
  }

  return out;
}

export function diffStats(lines: readonly DiffLine[]): DiffStats {
  return {
    added: lines.filter((line) => line.kind === 'added').length,
    removed: lines.filter((line) => line.kind === 'removed').length,
  };
}

/** 変更のある場所だけを、前後 context 行つきで抜き出す。 */
export function diffHunks(lines: readonly DiffLine[], context = 2): DiffLine[][] {
  const keep = new Set<number>();
  lines.forEach((line, i) => {
    if (line.kind === 'same') return;
    for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) {
      keep.add(j);
    }
  });

  const hunks: DiffLine[][] = [];
  let current: DiffLine[] = [];
  let previous = -2;

  for (let i = 0; i < lines.length; i++) {
    if (!keep.has(i)) continue;
    if (i !== previous + 1 && current.length > 0) {
      hunks.push(current);
      current = [];
    }
    current.push(lines[i]!);
    previous = i;
  }
  if (current.length > 0) hunks.push(current);
  return hunks;
}

function diffMiddle(a: readonly string[], b: readonly string[], offset: number): DiffLine[] {
  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0) {
    return b.map((text, i) => ({ kind: 'added' as const, text, rightLine: offset + i + 1 }));
  }
  if (b.length === 0) {
    return a.map((text, i) => ({ kind: 'removed' as const, text, leftLine: offset + i + 1 }));
  }

  // 大きすぎるときは中身を突き合わせず、まるごと差し替えとして見せる。
  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) {
    return [
      ...a.map((text, i) => ({ kind: 'removed' as const, text, leftLine: offset + i + 1 })),
      ...b.map((text, i) => ({ kind: 'added' as const, text, rightLine: offset + i + 1 })),
    ];
  }

  const table = lcsTable(a, b);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]!, leftLine: offset + i + 1, rightLine: offset + j + 1 });
      i++;
      j++;
      continue;
    }
    // 残りの一致数が多いほうへ進む。同点なら削除を先に出して読み順を安定させる。
    if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      out.push({ kind: 'removed', text: a[i]!, leftLine: offset + i + 1 });
      i++;
    } else {
      out.push({ kind: 'added', text: b[j]!, rightLine: offset + j + 1 });
      j++;
    }
  }

  for (; i < a.length; i++) out.push({ kind: 'removed', text: a[i]!, leftLine: offset + i + 1 });
  for (; j < b.length; j++) out.push({ kind: 'added', text: b[j]!, rightLine: offset + j + 1 });
  return out;
}

/** table[i][j] = a[i..] と b[j..] の最長共通部分列の長さ */
function lcsTable(a: readonly string[], b: readonly string[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j]
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  return table;
}

function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  // 末尾の改行で空行が1つ増えるだけなので落とす。
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}
