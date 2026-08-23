import type { LinkRef } from '../markdown/wikilink';
import { basename, extname, stripDocumentExtension } from '../vault/path';
import type { VPath } from '../vault/types';

export interface LinkRewrite {
  from: number;
  to: number;
  before: string;
  after: string;
}

export interface RenameLinksResult {
  text: string;
  rewrites: LinkRewrite[];
}

/** 解決済みのリンクだけを、後ろのオフセットから安全に書き換える。 */
export function renameResolvedLinks(
  text: string,
  refs: readonly LinkRef[],
  newPath: VPath,
): RenameLinksResult {
  const rewrites = refs
    .map((ref) => ({
      from: ref.from,
      to: ref.to,
      before: ref.raw,
      after: rewriteRef(ref, renamedTarget(ref, newPath)),
    }))
    .filter((rewrite) => text.slice(rewrite.from, rewrite.to) === rewrite.before)
    .sort((a, b) => b.from - a.from);

  let output = text;
  for (const rewrite of rewrites) {
    output = output.slice(0, rewrite.from) + rewrite.after + output.slice(rewrite.to);
  }

  return { text: output, rewrites: [...rewrites].reverse() };
}

function renamedTarget(ref: LinkRef, newPath: VPath): string {
  const pathStyle = ref.target.includes('/');
  let target = pathStyle ? stripDocumentExtension(newPath) : basename(newPath, true);

  // [[Foo.md]] のように拡張子を明示していた場合は、その表記も維持する。
  const wikiTarget = /^!?\[\[([\s\S]*?)\]\]$/.exec(ref.raw)?.[1]?.split(/[|#]/, 1)[0];
  const markdownTarget = /^!?\[[\s\S]*?\]\(([^()\s]*)\)$/.exec(ref.raw)?.[1]?.split('#', 1)[0];
  const oldTarget = safeDecodeUri(wikiTarget ?? markdownTarget ?? '').trim();
  if (/\.[a-z0-9]+$/i.test(oldTarget)) target += extname(newPath);
  return target;
}

function safeDecodeUri(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function rewriteRef(ref: LinkRef, target: string): string {
  const destination = `${target}${ref.subpath ?? ''}`;
  if (/^!?\[\[/.test(ref.raw)) {
    const prefix = ref.embed ? '!' : '';
    return `${prefix}[[${destination}${ref.alias ? `|${ref.alias}` : ''}]]`;
  }

  const label = ref.alias ?? '';
  const prefix = ref.embed ? '!' : '';
  const href = destination.replace(/[\s()]/g, (char) => encodeURIComponent(char));
  return `${prefix}[${label}](${href})`;
}
