import type { VPath } from './types';

/** "/a//b/../c/" -> "a/c" 。".." はルートを超えない。 */
export function normalize(p: string): VPath {
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join('/');
}

export function join(...parts: string[]): VPath {
  return normalize(parts.join('/'));
}

export function segments(p: VPath): string[] {
  const n = normalize(p);
  return n === '' ? [] : n.split('/');
}

/** "AI/Ollama.md" -> "AI" ／ "Ollama.md" -> "" */
export function dirname(p: VPath): VPath {
  const segs = segments(p);
  segs.pop();
  return segs.join('/');
}

/** stripExt=true なら "AI/Ollama.md" -> "Ollama" */
export function basename(p: VPath, stripExt = false): string {
  const segs = segments(p);
  const last = segs.length > 0 ? segs[segs.length - 1]! : '';
  if (!stripExt) return last;
  const ext = extname(last);
  return ext ? last.slice(0, -ext.length) : last;
}

/** "note.md" -> ".md" ／ 拡張子なし・先頭ドットのみは "" */
export function extname(p: VPath): string {
  const name = basename(p);
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i) : '';
}

export function isMarkdown(p: VPath): boolean {
  return extname(p).toLowerCase() === '.md';
}

export function isHtml(p: VPath): boolean {
  const ext = extname(p).toLowerCase();
  return ext === '.html' || ext === '.htm';
}

/** Shiorbit がテキストとして開いて編集できるファイル。 */
export function isSupportedDocument(p: VPath): boolean {
  return isMarkdown(p) || isHtml(p);
}

/** 対応ドキュメントの拡張子だけを取り除く。 */
export function stripDocumentExtension(p: VPath): string {
  return isSupportedDocument(p) ? p.slice(0, -extname(p).length) : p;
}

/**
 * fromDir から to へ辿るための相対パス。
 * HTML の href のように、ファイルからの相対で書かれた参照を書き直すときに使う。
 */
export function relative(fromDir: VPath, to: VPath): string {
  const base = segments(fromDir);
  const target = segments(to);

  let common = 0;
  while (common < base.length && common < target.length - 1 && base[common] === target[common]) {
    common++;
  }

  const ups = Array.from({ length: base.length - common }, () => '..');
  const rest = target.slice(common);
  return [...ups, ...rest].join('/');
}

/** parent が child の祖先か (parent === '' はルートなので常に true) */
export function isAncestor(parent: VPath, child: VPath): boolean {
  const a = normalize(parent);
  const b = normalize(child);
  if (a === '') return b !== '';
  return b.startsWith(a + '/');
}

/** 隠しフォルダ・設定フォルダを Vault の走査対象から外す */
export function isHidden(p: VPath): boolean {
  return segments(p).some((s) => s.startsWith('.'));
}
