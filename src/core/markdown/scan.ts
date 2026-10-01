import type { VPath } from '../vault/types';
import { basename } from '../vault/path';
import { maskCode } from './code';
import { parseFrontmatter } from './frontmatter';
import { parseLinks, type LinkRef } from './wikilink';

export interface Heading {
  level: number;
  text: string;
  offset: number;
}

/** ノート1件のメタ情報。本文は持たない (設計書 §5) */
export interface NoteMeta {
  path: VPath;
  /** 拡張子を除いたファイル名。リンク解決の主役 */
  basename: string;
  mtime: number;
  size: number;
  frontmatter: Record<string, unknown>;
  headings: Heading[];
  blockIds: string[];
  /** [[...]] と内部 Markdown リンク */
  links: LinkRef[];
  /** ![[...]] による埋め込み */
  embeds: LinkRef[];
  tags: string[];
}

const HEADING = /^[ \t]{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;
const BLOCK_ID = /(?:^|[ \t])\^([A-Za-z0-9][A-Za-z0-9-]*)[ \t]*$/gm;
const TAG = /(?:^|[\s(\[])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu;

/** 本文を解析して NoteMeta を作る。プラットフォームに一切依存しない純粋関数。 */
export function scanNote(
  path: VPath,
  text: string,
  stat: { mtime: number; size: number },
): NoteMeta {
  const fm = parseFrontmatter(text);
  const masked = maskCode(text);
  // frontmatter 領域は見出し・タグの走査対象から外す。
  // 改行だけは残す — 潰すと直後の見出しが行頭でなくなってしまう。
  const head = masked.slice(0, fm.bodyStart).replace(/[^\n]/g, ' ');
  const body = head + masked.slice(fm.bodyStart);

  const headings: Heading[] = [];
  for (const m of body.matchAll(HEADING)) {
    // マスク済みテキストで位置を特定し、見出し文字列は元テキストから取り直す
    const raw = text.slice(m.index, m.index + m[0].length);
    const re = /^[ \t]{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(raw);
    headings.push({
      level: (m[1] ?? '').length,
      text: (re?.[2] ?? m[2] ?? '').trim(),
      offset: m.index,
    });
  }

  const blockIds: string[] = [];
  for (const m of body.matchAll(BLOCK_ID)) blockIds.push(m[1]!);

  const allRefs = parseLinks(text);

  return {
    path,
    basename: basename(path, true),
    mtime: stat.mtime,
    size: stat.size,
    frontmatter: fm.data,
    headings,
    blockIds,
    links: allRefs.filter((r) => !r.embed),
    embeds: allRefs.filter((r) => r.embed),
    tags: collectTags(body, fm.data),
  };
}

function collectTags(body: string, fm: Record<string, unknown>): string[] {
  const set = new Set<string>();

  for (const m of body.matchAll(TAG)) {
    const tag = m[1]!;
    // 数字だけのものは見出しアンカーや ID の誤検出になりやすいので除外
    if (!/^\d+$/.test(tag)) set.add(tag);
  }

  for (const tag of frontmatterTags(fm)) set.add(tag);
  return [...set];
}

/** 手動指定のタグ。自動収集の設定にかかわらず有効にする。 */
export function frontmatterTags(fm: Record<string, unknown>): string[] {
  const set = new Set<string>();
  for (const key of ['tags', 'tag']) {
    const value = fm[key];
    if (typeof value === 'string') {
      for (const t of value.split(/[,\s]+/)) if (t) set.add(t.replace(/^#/, ''));
    } else if (Array.isArray(value)) {
      for (const t of value) if (typeof t === 'string' && t) set.add(t.replace(/^#/, ''));
    }
  }

  return [...set];
}

/** リンクが現れる行を切り出す。バックリンクの文脈表示に使う。 */
export function extractContext(text: string, from: number, to: number): string {
  const start = text.lastIndexOf('\n', from - 1) + 1;
  const nlEnd = text.indexOf('\n', to);
  const end = nlEnd === -1 ? text.length : nlEnd;
  return text.slice(start, end).trim();
}

/** 表示用のタイトル。frontmatter.title > 最初の H1 > ファイル名 */
export function displayTitle(meta: NoteMeta): string {
  const title = meta.frontmatter['title'];
  if (typeof title === 'string' && title.trim() !== '') return title.trim();
  const h1 = meta.headings.find((h) => h.level === 1);
  if (h1) return h1.text;
  return meta.basename;
}

/** frontmatter の aliases を配列で取り出す */
export function aliasesOf(meta: NoteMeta): string[] {
  const raw = meta.frontmatter['aliases'] ?? meta.frontmatter['alias'];
  if (typeof raw === 'string') return raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === 'string' && s !== '');
  return [];
}
