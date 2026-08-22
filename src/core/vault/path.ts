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
