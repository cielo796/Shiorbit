export interface Frontmatter {
  data: Record<string, unknown>;
  /** 本文の開始オフセット (frontmatter が無ければ 0) */
  bodyStart: number;
}

const FENCE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * YAML frontmatter の最小実装。
 * Obsidian で実用上使われる範囲 (スカラー・インライン配列・ブロック配列) だけを扱う。
 * 完全な YAML パーサではないので、解釈できない行は文字列として素直に残す。
 */
export function parseFrontmatter(text: string): Frontmatter {
  const m = FENCE.exec(text);
  if (!m || m.index !== 0) return { data: {}, bodyStart: 0 };

  const data: Record<string, unknown> = {};
  const lines = (m[1] ?? '').split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;

    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!;
    const rawValue = (kv[2] ?? '').trim();

    if (rawValue === '') {
      // ブロック配列:  key:\n  - a\n  - b
      const items: string[] = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1]!)) {
        items.push(scalar(lines[++i]!.replace(/^\s*-\s+/, '').trim()) as string);
      }
      data[key] = items.length > 0 ? items : '';
      continue;
    }

    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      data[key] = rawValue
        .slice(1, -1)
        .split(',')
        .map((s) => scalar(s.trim()))
        .filter((s) => s !== '');
      continue;
    }

    data[key] = scalar(rawValue);
  }

  return { data, bodyStart: m[0].length };
}

function scalar(s: string): unknown {
  if (s === '') return '';
  const unquoted = /^(['"])([\s\S]*)\1$/.exec(s);
  if (unquoted) return unquoted[2];
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}
