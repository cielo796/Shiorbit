import type { LinkRef } from '../markdown/wikilink';
import { extractContext } from '../markdown/scan';
import { basename, isHtml } from '../vault/path';
import { limitContext } from '../text/excerpt';
import { searchText } from './searchText';

const HTML_CONTEXT_WINDOW = 4096;

/** 元本文の座標は変えず、表示・保存する文脈だけを小さくする。 */
export function linkContext(path: string, source: string, ref: LinkRef): string {
  if (!isHtml(path)) return extractContext(source, ref.from, ref.to);
  const fallback = limitContext(basename(ref.target, true) || '文書内リンク');
  const start = source.lastIndexOf('<', ref.from);
  if (start < 0) return fallback;
  const tag = source.slice(start, start + HTML_CONTEXT_WINDOW);
  const end = tagEnd(tag);
  if (end < 0) return fallback;
  const opening = tag.slice(0, end + 1);
  if (/^<img\b/i.test(opening)) {
    const alt = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(opening);
    const text = alt ? visibleText(alt[1] ?? alt[2] ?? '') : '';
    return text || fallback;
  }
  if (!/^<a\b/i.test(opening)) return fallback;
  // 不完全な巨大imgタグ等はsearchTextが属性ごと捨てる。全文は走査・複製しない。
  const tail = source.slice(start + end + 1, start + end + 1 + HTML_CONTEXT_WINDOW);
  const closing = /<\/a\s*>/i.exec(tail);
  const text = visibleText(closing ? tail.slice(0, closing.index) : tail);
  return text || fallback;
}

function visibleText(fragment: string): string {
  return limitContext(searchText('context.html', fragment).replace(/\s+/g, ' ').trim());
}

function tagEnd(tag: string): number {
  let quote = '';
  for (let at = 1; at < tag.length; at++) {
    const ch = tag[at]!;
    if (quote) { if (ch === quote) quote = ''; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return at;
  }
  return -1;
}
