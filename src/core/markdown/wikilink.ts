import { maskCode } from './code';

export interface LinkRef {
  /** 元の記法そのまま 例: "[[LocalLLM#実行環境|ローカルLLM]]" */
  raw: string;
  /** リンク先の名前。"" は自ノート内リンク ([[#見出し]]) */
  target: string;
  /** "#見出し" または "#^blockid" */
  subpath?: string;
  /** 表示名 */
  alias?: string;
  /** ![[...]] による埋め込みか */
  embed: boolean;
  /** 本文中のオフセット (リネーム時の一括置換に使う) */
  from: number;
  to: number;
}

const WIKILINK = /(!?)\[\[([^\[\]\n]*?)\]\]/g;
const MD_LINK = /(!?)\[([^\[\]\n]*)\]\(([^()\s]*)\)/g;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * [[WikiLink]] と、内部を指す Markdown リンクを抽出する。
 * コードブロック内・インラインコード内・エスケープされたものは無視する。
 */
export function parseLinks(text: string): LinkRef[] {
  const masked = maskCode(text);
  const refs: LinkRef[] = [];

  for (const m of masked.matchAll(WIKILINK)) {
    const inner = m[2] ?? '';
    if (inner.trim() === '') continue;
    const parsed = splitInner(inner);
    if (parsed.target === '' && parsed.subpath === undefined) continue;
    refs.push({
      raw: text.slice(m.index, m.index + m[0].length),
      ...parsed,
      embed: m[1] === '!',
      from: m.index,
      to: m.index + m[0].length,
    });
  }

  for (const m of masked.matchAll(MD_LINK)) {
    const href = decodeUri(m[3] ?? '');
    if (href === '' || EXTERNAL.test(href)) continue;
    const parsed = splitInner(href);
    if (parsed.target === '' && parsed.subpath === undefined) continue;
    const alias = (m[2] ?? '').trim();
    refs.push({
      raw: text.slice(m.index, m.index + m[0].length),
      target: parsed.target,
      ...(parsed.subpath !== undefined ? { subpath: parsed.subpath } : {}),
      ...(alias !== '' ? { alias } : {}),
      embed: m[1] === '!',
      from: m.index,
      to: m.index + m[0].length,
    });
  }

  return refs.sort((a, b) => a.from - b.from);
}

/** "Foo#見出し|表示名" を分解する */
function splitInner(inner: string): { target: string; subpath?: string; alias?: string } {
  let rest = inner;
  let alias: string | undefined;

  const pipe = rest.indexOf('|');
  if (pipe >= 0) {
    alias = rest.slice(pipe + 1).trim();
    rest = rest.slice(0, pipe);
  }

  let subpath: string | undefined;
  const hash = rest.indexOf('#');
  if (hash >= 0) {
    const sub = rest.slice(hash).trim();
    if (sub.length > 1) subpath = sub;
    rest = rest.slice(0, hash);
  }

  const target = rest.trim().replace(/\.md$/i, '');
  return {
    target,
    ...(subpath !== undefined ? { subpath } : {}),
    ...(alias !== undefined && alias !== '' ? { alias } : {}),
  };
}

function decodeUri(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** リンクの表示テキスト */
export function linkDisplay(ref: LinkRef): string {
  if (ref.alias) return ref.alias;
  if (ref.target === '') return ref.subpath ?? '';
  return ref.subpath ? `${ref.target}${ref.subpath}` : ref.target;
}

/** 挿入用の記法を組み立てる */
export function formatWikilink(target: string, alias?: string): string {
  return alias && alias !== target ? `[[${target}|${alias}]]` : `[[${target}]]`;
}
