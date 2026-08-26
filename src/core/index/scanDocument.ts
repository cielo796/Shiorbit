import type { NoteMeta } from '../markdown/scan';
import { scanNote } from '../markdown/scan';
import type { LinkRef } from '../markdown/wikilink';
import { basename, dirname, isHtml, join } from '../vault/path';
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

  const refs = parseHtmlLinks(path, text);
  return {
    path,
    basename: basename(path, true),
    mtime: stat.mtime,
    size: stat.size,
    frontmatter: title === '' ? {} : { title },
    headings,
    blockIds: [],
    links: refs.filter((ref) => !ref.embed),
    embeds: refs.filter((ref) => ref.embed),
    tags: [],
  };
}

const ANCHOR = /<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const IMAGE = /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * HTML の `<a href>` と `<img src>` から、Vault 内を指す参照だけを拾う。
 *
 * from / to は **URL の文字列そのもの**を指す。
 * 改名で書き換えるときに、タグの他の属性へ触れずに済ませるため。
 */
export function parseHtmlLinks(path: VPath, text: string): LinkRef[] {
  const refs: LinkRef[] = [];
  const dir = dirname(path);

  const collect = (pattern: RegExp, embed: boolean): void => {
    for (const match of text.matchAll(pattern)) {
      const href = match[1] ?? match[2] ?? match[3] ?? '';
      const resolved = toVaultTarget(dir, href);
      if (resolved === null) continue;

      // タグ全体ではなく、URL の位置を測る。
      const at = text.indexOf(href, match.index);
      if (at < 0) continue;
      refs.push({
        raw: href,
        target: resolved.target,
        ...(resolved.subpath !== undefined ? { subpath: resolved.subpath } : {}),
        embed,
        from: at,
        to: at + href.length,
      });
    }
  };

  collect(ANCHOR, false);
  collect(IMAGE, true);
  refs.sort((a, b) => a.from - b.from);
  return refs;
}

/** 外部・ページ内・データ URL は Vault の参照ではないので落とす。 */
function toVaultTarget(dir: VPath, href: string): { target: string; subpath?: string } | null {
  const trimmed = href.trim();
  if (trimmed === '' || trimmed.startsWith('#') || EXTERNAL.test(trimmed)) return null;

  const hash = trimmed.indexOf('#');
  const subpath = hash >= 0 ? trimmed.slice(hash) : undefined;
  const withoutHash = hash >= 0 ? trimmed.slice(0, hash) : trimmed;
  const withoutQuery = withoutHash.split('?')[0] ?? '';
  if (withoutQuery === '') return null;

  const decoded = safeDecodeUri(withoutQuery);
  // 先頭の / は Vault のルートから、それ以外はこのファイルからの相対。
  const target = decoded.startsWith('/') ? join(decoded) : join(dir, decoded);
  if (target === '') return null;
  return subpath === undefined ? { target } : { target, subpath };
}

function safeDecodeUri(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
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
