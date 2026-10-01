// @vitest-environment jsdom
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import { openSearchPanel, search, SearchQuery, setSearchQuery } from '@codemirror/search';
import { SearchPanel, type SearchPanelOptions } from '../src/ui/search/SearchPanel';
import { enumerateMatches, searchSnapshot } from '../src/ui/search/searchState';
import { SearchHistory } from '../src/core/search/SearchHistory';
import { MarkdownEditor } from '../src/ui/editor';
import type { VaultMatches } from '../src/core/search/matches';

beforeAll(() => {
  Object.assign(Range.prototype, {
    getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    getClientRects: () => Object.assign([], { item: () => null }),
  });
});
const cleanups: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanups.splice(0)) dispose(); document.body.replaceChildren(); });
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
function setup(doc = 'cat cat CAT catalog', overrides: Partial<SearchPanelOptions> = {}): EditorView {
  const opts: SearchPanelOptions = { history: new SearchHistory(), session: { replaceExpanded: false }, ...overrides };
  const view = new EditorView({ state: EditorState.create({ doc, extensions: [
    search({ top: true, createPanel: (v) => new SearchPanel(v, opts) }), searchSnapshot, history(), EditorState.allowMultipleSelections.of(true),
  ] }), parent: document.body });
  cleanups.push(() => view.destroy());
  openSearchPanel(view);
  return view;
}
function input(value: string): void {
  const field = document.querySelector<HTMLInputElement>('[aria-label="検索語"]')!;
  field.value = value; field.dispatchEvent(new Event('input', { bubbles: true }));
}
function click(label: string): void {
  const b = [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent === label || node.getAttribute('aria-label') === label);
  expect(b, label).toBeDefined(); b!.click();
}
function key(node: Element, name: string, options: KeyboardEventInit = {}): void {
  node.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options }));
}
const counter = (): string | null => document.querySelector('.search-counter')!.textContent;

describe('フローティング検索パネル', () => {
  it('入力直後の現在位置と総数が同じクエリで計算され、前後に循環する', async () => {
    const view = setup(); await tick();
    input('cat');
    expect(counter()).toBe('1 / 4');
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('cat');
    click('↓'); expect(counter()).toBe('2 / 4');
    click('↑'); expect(counter()).toBe('1 / 4');
    click('↑'); expect(counter()).toBe('4 / 4');
    expect(document.querySelector('.shiorbit-search-panel')!.getAttribute('role')).toBe('search');
    expect(document.querySelector('.cm-panels-bottom')).toBeNull();
  });
  it('オプションを切り替えると件数と選択が変わり、不正な正規表現も落ちない', async () => {
    setup(); await tick(); input('cat');
    click('大文字小文字を区別'); expect(counter()).toBe('1 / 3');
    click('単語単位'); expect(counter()).toBe('1 / 2');
    click('正規表現'); input('[');
    expect(counter()).toBe('0 / 0');
    expect(document.querySelector('.search-field')!.classList.contains('no-matches')).toBe(true);
    expect(document.querySelector('[aria-label="検索語"]')!.getAttribute('aria-invalid')).toBe('true');
    input(''); expect((document.querySelector('.search-counter') as HTMLElement).hidden).toBe(true);
  });
  it('置換行は既定で閉じ、正規表現のグループ置換とUndoは従来処理を使う', async () => {
    const view = setup('cat1 cat2'); await tick();
    expect((document.querySelector('.search-replace-row') as HTMLElement).hidden).toBe(true);
    click('▸ 置換'); click('正規表現'); input('cat(\\d)');
    const field = document.querySelector<HTMLInputElement>('[aria-label="置換後の文字列"]')!;
    field.value = 'dog$1'; field.dispatchEvent(new Event('input'));
    click('2件すべて置換');
    expect(view.state.doc.toString()).toBe('dog1 dog2');
    expect(counter()).toBe('0 / 0');
    undo(view); expect(view.state.doc.toString()).toBe('cat1 cat2');
    expect(counter()).toBe('1 / 2');
    click('↓'); click('1件を置換');
    expect(view.state.doc.toString()).toContain('dog');
  });
  it('履歴の矢印・EnterとEscの2段階動作、Tabトラップが働く', async () => {
    const historyStore = new SearchHistory();
    historyStore.remember('cat', 4); historyStore.remember('dog', 2);
    const view = setup(undefined, { history: historyStore }); await tick();
    click('検索履歴');
    // 初回フォーカスでも開いている場合があるので明示してから使う。
    if ((document.querySelector('.search-history') as HTMLElement).hidden) click('検索履歴');
    const field = document.querySelector<HTMLInputElement>('[aria-label="検索語"]')!;
    key(field, 'ArrowDown'); key(field, 'ArrowDown'); key(field, 'Enter');
    expect(field.value).toBe('cat');
    click('検索履歴'); key(field, 'Escape');
    expect((document.querySelector('.search-history') as HTMLElement).hidden).toBe(true);
    field.focus(); key(field, 'Tab', { shiftKey: true });
    expect(document.querySelector('.shiorbit-search-panel')!.contains(document.activeElement)).toBe(true);
    key(document.activeElement!, 'Escape');
    expect(document.querySelector('.shiorbit-search-panel')).toBeNull();
    expect(view.hasFocus).toBe(true);
  });
  it('閉じても実行中の置換行の開閉状態だけは維持する', async () => {
    const view = setup(); await tick(); click('▸ 置換'); click('閉じる（Esc）');
    openSearchPanel(view); await tick();
    expect((document.querySelector('.search-replace-row') as HTMLElement).hidden).toBe(false);
  });
  it('検索中に本文を変更すると件数が更新される', async () => {
    const view = setup('cat'); await tick(); input('cat');
    view.dispatch({ changes: { from: 3, insert: ' cat' } });
    expect(counter()).toBe('1 / 2');
  });
  it('ゼロ幅・複数行・単語単位をCodeMirrorと同じ意味で列挙する', () => {
    expect(enumerateMatches(new SearchQuery({ search: '^', regexp: true }), 'one\ntwo')).toEqual([{ from: 0, to: 0 }, { from: 4, to: 4 }]);
    expect(enumerateMatches(new SearchQuery({ search: 'a\\nb' }), 'a\nb')).toEqual([{ from: 0, to: 3 }]);
    expect(enumerateMatches(new SearchQuery({ search: 'cat', wholeWord: true }), 'cat catalog CAT')).toHaveLength(2);
  });
  it('旧allはメニューで使える', async () => {
    const view = setup(); await tick(); input('cat');
    click('その他の検索操作'); click('一致箇所をすべて選択');
    expect(view.state.selection.ranges.length).toBe(4);
  });
  it('全ノートの件数と結果ジャンプが使え、全ノート置換は無効', async () => {
    const result: VaultMatches = { total: 1, skipped: 0, documents: [{ path: 'b.md', title: 'B', count: 1,
      ranges: [{ from: 4, to: 7 }], matches: [{ from: 4, to: 7, line: 2, before: '', hit: 'cat', after: '' }] }] };
    const openResult = vi.fn(async () => undefined);
    setup('cat', { searchAll: async () => result, openResult }); await tick(); input('cat'); click('全ノート');
    await vi.waitFor(() => expect(counter()).toBe('0 / 1'));
    click('▸ 置換');
    expect([...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent === '1件を置換')!.disabled).toBe(true);
    (document.querySelector('.search-result-match') as HTMLButtonElement).click();
    expect(openResult).toHaveBeenCalledWith('b.md', expect.objectContaining({ from: 4, to: 7 }), expect.any(SearchQuery));
  });
  it('遅い旧クエリが戻っても新しい結果を上書きしない', async () => {
    let resolveOld!: (value: VaultMatches) => void;
    const searchAll = vi.fn((query: SearchQuery) => query.search === 'cat' ? new Promise<VaultMatches>((resolve) => { resolveOld = resolve; }) : Promise.resolve({ total: 0, documents: [], skipped: 0 }));
    setup('cat', { searchAll }); await tick(); input('cat'); click('全ノート');
    await vi.waitFor(() => expect(searchAll).toHaveBeenCalledOnce());
    input('nothing');
    resolveOld({ total: 99, documents: [], skipped: 0 });
    await vi.waitFor(() => expect(counter()).toBe('0 / 0'));
  });
  it('Ctrl+Fは長い選択文字も取り込み、Ctrl+Hは置換を開く', async () => {
    const editor = new MarkdownEditor({ onChange: () => undefined, onSave: () => undefined });
    cleanups.push(() => editor.destroy()); document.body.append(editor.dom);
    const text = '検索する長い選択'.repeat(30);
    editor.setDoc(text);
    editor.setViewState({ anchor: 0, head: text.length, scrollTop: 0 });
    editor.focus();
    key(editor.dom.querySelector('.cm-content')!, 'f', { ctrlKey: true }); await tick();
    expect(document.querySelector<HTMLInputElement>('[aria-label="検索語"]')!.value).toBe(text);
    key(document.querySelector('[aria-label="検索語"]')!, 'h', { ctrlKey: true });
    expect((document.querySelector('.search-replace-row') as HTMLElement).hidden).toBe(false);
  });
  it('選択位置が変わっても検索結果配列は再利用する', () => {
    const view = setup('cat cat'); input('cat');
    const matches = view.state.field(searchSnapshot).matches;
    view.dispatch({ selection: EditorSelection.single(4, 7) });
    expect(view.state.field(searchSnapshot).matches).toBe(matches);
    expect(view.state.field(searchSnapshot).current).toBe(1);
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'cat', replace: 'x' })) });
    expect(view.state.field(searchSnapshot).matches).toBe(matches);
  });
});
