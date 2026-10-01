import type { VPath } from '../vault/types';

export interface TextMatch { from: number; to: number }
export interface MatchSnippet extends TextMatch {
  line: number;
  before: string;
  hit: string;
  after: string;
}
export interface DocumentMatches {
  path: VPath;
  title: string;
  count: number;
  ranges: readonly TextMatch[];
  matches: MatchSnippet[];
}
export interface VaultMatches { documents: DocumentMatches[]; total: number; skipped: number }
export type MatchText = (text: string) => readonly TextMatch[];

/** 元のオフセットを維持し、改行を含む一致でもジャンプ先をずらさない。 */
export function matchSnippet(text: string, match: TextMatch): MatchSnippet {
  const start = Math.max(text.lastIndexOf('\n', match.from - 1) + 1, match.from - 45);
  const endOfLine = text.indexOf('\n', match.to);
  const end = Math.min(endOfLine < 0 ? text.length : endOfLine, match.to + 65);
  return {
    ...match,
    line: text.slice(0, match.from).split('\n').length,
    before: (start > 0 ? '…' : '') + text.slice(start, match.from),
    hit: text.slice(match.from, Math.min(match.to, match.from + 140)) || '▏',
    after: (match.to - match.from > 140 ? '…' : '') + text.slice(match.to, end) + (end < text.length ? '…' : ''),
  };
}
