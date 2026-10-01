import { EditorState, StateField, Text } from '@codemirror/state';
import { getSearchQuery, SearchQuery } from '@codemirror/search';
import type { TextMatch } from '../../core/search/matches';

/** カウンタは独自正規表現を使わず、置換・ハイライトと同じ CodeMirror のクエリを読む。 */
export function enumerateMatches(query: SearchQuery, text: EditorState | Text | string): TextMatch[] {
  if (!query.valid) return [];
  const cursor = query.getCursor(typeof text === 'string' ? Text.of(text.split(/\r\n?|\n/)) : text);
  const matches: TextMatch[] = [];
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    matches.push({ from: next.value.from, to: next.value.to });
  }
  return matches;
}

export function sameSearch(a: SearchQuery, b: SearchQuery): boolean {
  return a.search === b.search && a.caseSensitive === b.caseSensitive && a.regexp === b.regexp
    && a.wholeWord === b.wholeWord && a.literal === b.literal;
}

export interface SearchSnapshot { query: SearchQuery; matches: readonly TextMatch[]; current: number }
function snapshot(state: EditorState, old?: SearchSnapshot, docChanged = false): SearchSnapshot {
  const query = getSearchQuery(state);
  const matches = old && !docChanged && sameSearch(query, old.query) ? old.matches : enumerateMatches(query, state);
  const selection = state.selection.main;
  const current = matches.findIndex((hit) => hit.from === selection.from && hit.to === selection.to);
  return { query, matches, current };
}

export const searchSnapshot = StateField.define<SearchSnapshot>({
  create: (state) => snapshot(state),
  update: (value, transaction) => snapshot(transaction.state, value, transaction.docChanged),
});
