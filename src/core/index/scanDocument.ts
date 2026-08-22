import type { NoteMeta } from '../markdown/scan';
import { scanNote } from '../markdown/scan';
import { basename, isHtml } from '../vault/path';
import type { VPath } from '../vault/types';

/** Markdown は従来どおり解析し、HTML は安全な最小メタ情報だけを抽出する。 */
export function scanDocument(
  path: VPath,
  text: string,
  stat: { mtime: number; size: number },
): NoteMeta {
  if (!isHtml(path)) return scanNote(path, text, stat);

  const headings = [...text.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)].map((match) => ({
    level: Number(match[1]),
    text: htmlText(match[2] ?? ''),
    offset: match.index,
  }));
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(text);
  const title = titleMatch ? htmlText(titleMatch[1] ?? '') : '';

  return {
    path,
    basename: basename(path, true),
    mtime: stat.mtime,
    size: stat.size,
    frontmatter: title === '' ? {} : { title },
    headings,
    blockIds: [],
    links: [],
    embeds: [],
    tags: [],
  };
}

function htmlText(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
