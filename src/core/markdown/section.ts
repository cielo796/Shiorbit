import { scanNote } from './scan';

/**
 * `![[ノート#見出し]]` `![[ノート#^ブロックID]]` の切り出し。
 *
 * 埋め込みの表示だけでなく、将来の引用にも使えるよう純粋関数にしてある。
 * subpath は `#` を含む形（`#見出し` / `#^id`）でも、含まない形でも受け取る。
 */
export function extractSection(text: string, subpath: string): string | null {
  const key = subpath.startsWith('#') ? subpath.slice(1) : subpath;
  if (key.trim() === '') return null;
  return key.startsWith('^')
    ? extractBlock(text, key.slice(1))
    : extractHeading(text, key);
}

/** 見出しから、同じか浅い見出しの直前まで。見つからなければ null。 */
function extractHeading(text: string, name: string): string | null {
  const headings = scanNote('x.md', text, { mtime: 0, size: 0 }).headings;
  const wanted = normalizeHeading(name);
  const at = headings.findIndex((heading) => normalizeHeading(heading.text) === wanted);
  if (at < 0) return null;

  const start = headings[at]!.offset;
  const level = headings[at]!.level;
  const next = headings.slice(at + 1).find((heading) => heading.level <= level);
  return text.slice(start, next ? next.offset : text.length).trimEnd();
}

/**
 * ブロック ID を末尾に持つ段落。
 * 空行で区切られた塊を1ブロックと見なす（Obsidian と同じ数え方）。
 */
function extractBlock(text: string, id: string): string | null {
  const pattern = new RegExp(`(?:^|[ \\t])\\^${escapeRegExp(id)}[ \\t]*$`, 'm');
  const found = pattern.exec(text);
  if (!found) return null;

  const lineEnd = text.indexOf('\n', found.index);
  const end = lineEnd < 0 ? text.length : lineEnd;
  const before = text.slice(0, found.index);
  const blank = before.lastIndexOf('\n\n');
  const start = blank < 0 ? 0 : blank + 2;
  return text.slice(start, end).replace(pattern, '').trimEnd();
}

/** 見出しの一致は前後の空白と大文字小文字を無視する。 */
function normalizeHeading(value: string): string {
  return value.trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
