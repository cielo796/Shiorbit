import { EditorSelection } from '@codemirror/state';
import { EditorView, type Panel, type ViewUpdate } from '@codemirror/view';
import {
  closeSearchPanel, findNext, findPrevious, getSearchQuery,
  replaceAll, replaceNext, SearchQuery, selectMatches, setSearchQuery,
} from '@codemirror/search';
import { undo, redo } from '@codemirror/commands';
import { SearchHistory } from '../../core/search/SearchHistory';
import type { TextMatch, VaultMatches } from '../../core/search/matches';
import type { VPath } from '../../core/vault/types';
import { button, el } from '../dom';
import { sameSearch, searchSnapshot } from './searchState';

export interface SearchSession { replaceExpanded: boolean }
export interface SearchPanelOptions {
  history: SearchHistory;
  session: SearchSession;
  path?: () => VPath | null;
  searchAll?: (query: SearchQuery, cancelled: () => boolean) => Promise<VaultMatches>;
  openResult?: (path: VPath, match: TextMatch, query: SearchQuery) => Promise<void>;
}

/** CodeMirror の置換・Undo をそのまま使い、操作面だけをフローティングにする。 */
export class SearchPanel implements Panel {
  readonly dom = el('div', 'shiorbit-search-panel');
  readonly top = true;
  private readonly input = el('input');
  private readonly replacement = el('input');
  private readonly counter = el('span', 'search-counter');
  private readonly inputBox = el('div', 'search-field');
  private readonly historyList = el('div', 'search-history');
  private readonly replaceRow = el('div', 'search-replace-row');
  private readonly results = el('div', 'search-all-results');
  private readonly status = el('div', 'search-panel-status');
  private readonly toggles = new Map<'caseSensitive' | 'regexp' | 'wholeWord', HTMLButtonElement>();
  private readonly scopeButtons: HTMLButtonElement[] = [];
  private readonly previous: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly replaceOne: HTMLButtonElement;
  private readonly replaceEvery: HTMLButtonElement;
  private readonly expandReplace: HTMLButtonElement;
  private readonly historyButton: HTMLButtonElement;
  private readonly menu: HTMLElement;
  private readonly more: HTMLButtonElement;
  private scope: 'note' | 'vault' = 'note';
  private historyIndex = -1;
  private historyTimer: ReturnType<typeof setTimeout> | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private destroyed = false;
  private busy = false;
  private all: VaultMatches = { documents: [], total: 0, skipped: 0 };
  private resizeObserver: ResizeObserver | null = null;
  private query: SearchQuery;
  private static nextId = 0;
  private readonly id = `search-panel-${++SearchPanel.nextId}`;

  constructor(private readonly view: EditorView, private readonly opts: SearchPanelOptions) {
    this.query = getSearchQuery(view.state);
    this.dom.setAttribute('role', 'search');
    this.dom.setAttribute('aria-label', '検索と置換');
    this.dom.addEventListener('keydown', (event) => this.keydown(event));
    this.dom.addEventListener('focusout', (event) => {
      if (!this.dom.contains(event.relatedTarget as Node | null)) this.closeHistory();
      this.measureOverlap();
    });
    this.dom.addEventListener('focusin', () => this.measureOverlap());
    this.dom.addEventListener('wheel', (event) => event.stopPropagation());

    const upper = el('div', 'search-panel-upper');
    const icon = el('span', 'search-field-icon', '⌕');
    icon.setAttribute('aria-hidden', 'true');
    this.input.setAttribute('aria-label', '検索語');
    this.input.setAttribute('main-field', 'true');
    this.input.setAttribute('role', 'combobox');
    this.input.setAttribute('aria-autocomplete', 'list');
    this.input.setAttribute('aria-controls', `${this.id}-history`);
    this.input.setAttribute('aria-expanded', 'false');
    this.input.name = 'search';
    this.input.placeholder = '検索';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.addEventListener('input', (event) => {
      if ((event as InputEvent).isComposing) return;
      this.closeHistory();
      this.commit({ search: this.input.value }, true);
    });
    this.input.addEventListener('compositionend', () => this.commit({ search: this.input.value }, true));
    this.input.addEventListener('focus', () => { if (!this.input.value) this.showHistory(); });
    this.counter.setAttribute('aria-live', 'polite');
    this.counter.setAttribute('aria-atomic', 'true');
    this.historyButton = this.iconButton('▾', '検索履歴', () => {
      if (this.historyList.hidden) this.showHistory(); else this.closeHistory();
    });
    this.historyButton.className = 'search-history-toggle';
    this.historyButton.setAttribute('aria-expanded', 'false');
    this.inputBox.append(icon, this.input, this.counter, this.historyButton);
    this.previous = this.iconButton('↑', '前へ（Shift+Enter）', () => this.navigate(-1));
    this.next = this.iconButton('↓', '次へ（Enter）', () => this.navigate(1));
    this.next.classList.add('search-next');
    upper.append(this.inputBox, this.previous, this.next, this.iconButton('✕', '閉じる（Esc）', () => this.close()));

    const lower = el('div', 'search-panel-lower');
    for (const [key, label, title] of [
      ['caseSensitive', 'Aa', '大文字小文字を区別'],
      ['regexp', '.*', '正規表現'],
      ['wholeWord', '⟦ab⟧', '単語単位'],
    ] as const) {
      const toggle = this.iconButton(label, title, () => this.commit({ [key]: !getSearchQuery(this.view.state)[key] }, true));
      toggle.className = 'search-option';
      toggle.setAttribute('role', 'switch');
      this.toggles.set(key, toggle);
      lower.append(toggle);
    }
    const segments = el('div', 'search-scope');
    segments.setAttribute('role', 'radiogroup');
    segments.setAttribute('aria-label', '検索範囲');
    ['このノート', '全ノート'].forEach((label, i) => {
      const segment = button(label, 'search-scope-segment', () => this.setScope(i === 0 ? 'note' : 'vault'));
      segment.type = 'button';
      segment.setAttribute('role', 'radio');
      segment.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        this.setScope(i === 0 ? 'vault' : 'note');
        this.scopeButtons[1 - i]?.focus();
      });
      if (i === 1 && !opts.searchAll) segment.disabled = true;
      this.scopeButtons.push(segment);
      segments.append(segment);
    });
    this.expandReplace = button('▸ 置換', 'search-expand-replace', () => this.setReplaceExpanded(!opts.session.replaceExpanded));
    this.expandReplace.type = 'button';
    lower.append(el('span', 'search-option-divider'), segments, this.expandReplace);

    this.replacement.placeholder = '置換後の文字列';
    this.replacement.setAttribute('aria-label', '置換後の文字列');
    this.replacement.addEventListener('input', () => this.commit({ replace: this.replacement.value }));
    const replaceActions = el('div', 'search-replace-actions');
    this.replaceOne = button('1件を置換', undefined, () => this.replace(false));
    this.replaceEvery = button('0件すべて置換', undefined, () => this.replace(true));
    replaceActions.append(this.replaceOne, this.replaceEvery, el('span', 'search-undo-hint', '元に戻す: Ctrl+Z'));
    this.replaceRow.append(this.replacement, replaceActions);

    this.historyList.id = `${this.id}-history`;
    this.historyList.setAttribute('role', 'listbox');
    this.historyList.setAttribute('aria-label', '検索履歴');
    this.historyList.hidden = true;
    this.status.setAttribute('aria-live', 'polite');
    this.menu = el('div', 'search-more-menu');
    this.menu.hidden = true;
    this.menu.append(button('一致箇所をすべて選択', undefined, () => {
      this.menu.hidden = true;
      this.more.setAttribute('aria-expanded', 'false');
      selectMatches(this.view);
      this.view.focus();
    }));
    this.more = this.iconButton('⋯', 'その他の検索操作', () => {
      this.menu.hidden = !this.menu.hidden;
      this.more.setAttribute('aria-expanded', String(!this.menu.hidden));
      if (!this.menu.hidden) this.menu.querySelector('button')?.focus();
    });
    this.more.className = 'search-more';
    this.more.setAttribute('aria-expanded', 'false');
    // 344pxの2段構成を保ち、従来の「all」は必要なときだけメニューで使う。
    const foot = el('div', 'search-panel-foot');
    foot.append(this.status);
    lower.append(this.more);
    this.dom.append(upper, lower, this.historyList, this.replaceRow, this.results, foot, this.menu);
    this.syncInputs();
    this.setReplaceExpanded(opts.session.replaceExpanded);
    this.renderCounter();
  }

  private iconButton(label: string, title: string, action: () => void): HTMLButtonElement {
    const control = button(label, 'search-icon-button', action);
    control.type = 'button';
    control.title = title;
    control.setAttribute('aria-label', title);
    return control;
  }

  mount(): void {
    this.view.dom.classList.add('has-floating-search');
    this.input.focus();
    this.input.select();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.measureOverlap());
      this.resizeObserver.observe(this.dom);
      this.resizeObserver.observe(this.view.dom);
    }
    this.view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
    this.measureOverlap();
    queueMicrotask(() => { if (!this.destroyed) this.selectNearest(); });
  }

  update(update: ViewUpdate): void {
    const query = getSearchQuery(update.state);
    const changed = !sameSearch(this.query, query);
    this.query = query;
    this.syncInputs();
    if (changed || update.docChanged) {
      if (this.scope === 'vault') this.scheduleAll();
      this.scheduleHistory();
    }
    this.renderCounter();
    if (update.selectionSet || update.docChanged || update.viewportChanged || update.geometryChanged) this.measureOverlap();
  }

  private syncInputs(): void {
    if (this.input.value !== this.query.search) this.input.value = this.query.search;
    if (this.replacement.value !== this.query.replace) this.replacement.value = this.query.replace;
    for (const [key, toggle] of this.toggles) toggle.setAttribute('aria-checked', String(this.query[key]));
    this.scopeButtons.forEach((control, i) => {
      const checked = i === (this.scope === 'note' ? 0 : 1);
      control.setAttribute('aria-checked', String(checked));
      control.tabIndex = checked ? 0 : -1;
    });
  }

  private commit(patch: Partial<SearchQuery>, select = false): void {
    this.view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ ...getSearchQuery(this.view.state), ...patch })) });
    if (select) this.selectNearest();
  }

  private selectNearest(): void {
    const { matches, current } = this.view.state.field(searchSnapshot);
    if (current >= 0 || !matches.length) return;
    const position = this.view.state.selection.main.from;
    const hit = matches.find((item) => item.from >= position) ?? matches[0]!;
    this.view.dispatch({
      selection: EditorSelection.single(hit.from, hit.to),
      effects: EditorView.scrollIntoView(hit.from, { y: 'nearest' }),
      userEvent: 'select.search',
    });
  }

  setReplaceExpanded(expanded: boolean): void {
    this.opts.session.replaceExpanded = expanded;
    this.replaceRow.hidden = !expanded;
    this.expandReplace.textContent = expanded ? '▾ 置換' : '▸ 置換';
    this.expandReplace.setAttribute('aria-expanded', String(expanded));
    this.measureOverlap();
  }

  private setScope(scope: 'note' | 'vault'): void {
    if (scope === 'vault' && !this.opts.searchAll) return;
    this.scope = scope;
    this.closeHistory();
    this.syncInputs();
    if (scope === 'vault') this.scheduleAll();
    else { this.generation++; this.busy = false; this.results.replaceChildren(); }
    this.renderCounter();
  }

  private renderCounter(): void {
    const local = this.view.state.field(searchSnapshot);
    let total = local.matches.length;
    let current = local.current + 1;
    if (this.scope === 'vault') {
      total = this.all.total;
      current = 0;
      let before = 0;
      for (const doc of this.all.documents) {
        const sel = this.view.state.selection.main;
        const at = doc.path === this.opts.path?.() ? doc.ranges.findIndex((hit) => hit.from === sel.from && hit.to === sel.to) : -1;
        if (at >= 0) current = before + at + 1;
        before += doc.count;
      }
    }
    this.counter.hidden = !this.query.search;
    const value = this.busy ? '…' : `${current} / ${total}`;
    if (this.counter.textContent !== value) this.counter.textContent = value;
    const empty = !!this.query.search && !this.busy && (!this.query.valid || total === 0);
    this.inputBox.classList.toggle('no-matches', empty);
    this.input.setAttribute('aria-invalid', String(!!this.query.search && !this.query.valid));
    this.previous.disabled = this.next.disabled = this.busy || !this.query.valid || !total;
    this.replaceOne.disabled = this.replaceEvery.disabled = this.scope !== 'note' || !this.query.valid || !local.matches.length || this.view.state.readOnly;
    this.replaceEvery.textContent = `${local.matches.length}件すべて置換`;
    this.more.disabled = !this.query.valid || !local.matches.length || this.scope !== 'note';
    this.status.textContent = !this.query.valid && this.query.search ? '正規表現が正しくありません'
      : this.scope === 'vault' ? this.busy ? '全ノートを検索中…' : `置換は「このノート」で実行${this.all.skipped ? `・${this.all.skipped}件読込不可` : ''}`
      : empty ? '一致する箇所はありません' : '';
  }

  private navigate(direction: 1 | -1): void {
    this.closeHistory();
    this.remember();
    if (this.scope === 'note') { (direction === 1 ? findNext : findPrevious)(this.view); return; }
    const flat = this.all.documents.flatMap((doc) => doc.ranges.map((match) => ({ path: doc.path, match })));
    if (!flat.length || this.busy) return;
    const selection = this.view.state.selection.main;
    const at = flat.findIndex((item) => item.path === this.opts.path?.() && item.match.from === selection.from && item.match.to === selection.to);
    const next = flat[at < 0 ? direction === 1 ? 0 : flat.length - 1 : (at + direction + flat.length) % flat.length]!;
    void this.openResult(next.path, next.match);
  }

  private replace(all: boolean): void {
    if (this.scope !== 'note') return;
    this.remember();
    (all ? replaceAll : replaceNext)(this.view);
  }

  private scheduleHistory(): void {
    if (this.historyTimer !== null) clearTimeout(this.historyTimer);
    this.historyTimer = setTimeout(() => this.remember(), 700);
  }

  private remember(): void {
    if (!this.query.valid || this.busy) return;
    this.opts.history.remember(this.query.search, this.scope === 'vault' ? this.all.total : this.view.state.field(searchSnapshot).matches.length);
  }

  private showHistory(): void {
    this.historyList.replaceChildren();
    const items = this.opts.history.items;
    if (!items.length) return;
    items.forEach((entry, i) => {
      const row = button('', 'search-history-item', () => this.chooseHistory(i));
      row.id = `${this.id}-history-${i}`;
      row.setAttribute('role', 'option');
      row.tabIndex = -1;
      row.append(el('span', undefined, '↻'), el('span', 'search-history-term', entry.term), el('span', 'search-history-count', String(entry.count)));
      this.historyList.append(row);
    });
    this.historyList.hidden = false;
    this.historyIndex = -1;
    this.input.setAttribute('aria-expanded', 'true');
    this.historyButton.setAttribute('aria-expanded', 'true');
    this.input.focus();
    this.updateHistorySelection();
  }

  private closeHistory(): void {
    this.historyList.hidden = true;
    this.historyIndex = -1;
    this.input.removeAttribute('aria-activedescendant');
    this.input.setAttribute('aria-expanded', 'false');
    this.historyButton.setAttribute('aria-expanded', 'false');
  }

  private updateHistorySelection(): void {
    [...this.historyList.children].forEach((node, i) => node.setAttribute('aria-selected', String(i === this.historyIndex)));
    if (this.historyIndex >= 0) this.input.setAttribute('aria-activedescendant', `${this.id}-history-${this.historyIndex}`);
  }

  private chooseHistory(index: number): void {
    const entry = this.opts.history.items[index];
    if (!entry) return;
    this.closeHistory();
    this.commit({ search: entry.term }, true);
    this.input.focus();
    this.input.select();
  }

  private scheduleAll(): void {
    const generation = ++this.generation;
    if (this.searchTimer !== null) clearTimeout(this.searchTimer);
    this.all = { documents: [], total: 0, skipped: 0 };
    this.results.replaceChildren();
    this.busy = this.query.valid;
    if (!this.query.valid) return;
    const query = this.query;
    this.searchTimer = setTimeout(() => {
      void this.runAll(query, generation);
    }, 180);
  }

  private async runAll(query: SearchQuery, generation: number): Promise<void> {
    const cancelled = (): boolean => this.destroyed || generation !== this.generation;
    if (cancelled()) return;
    try {
      const result = await this.opts.searchAll!(query, cancelled);
      if (cancelled()) return;
      this.all = result;
      this.busy = false;
      this.renderResults();
      this.renderCounter();
      this.remember();
    } catch {
      if (cancelled()) return;
      this.busy = false;
      this.renderCounter();
      this.status.textContent = '検索に失敗しました。もう一度お試しください。';
    }
    this.measureOverlap();
  }

  private renderResults(): void {
    this.results.replaceChildren();
    for (const doc of this.all.documents) {
      const group = el('details', 'search-result-group');
      group.open = this.all.documents.length <= 3;
      const summary = el('summary');
      summary.title = doc.path;
      summary.append(el('span', 'search-result-name', doc.title), el('span', undefined, `${doc.count}件`));
      group.append(summary);
      for (const match of doc.matches) {
        const row = button('', 'search-result-match', () => { void this.openResult(doc.path, match); });
        row.title = `${doc.path}:${match.line}`;
        row.append(el('span', 'search-result-line', `${match.line}: `), match.before, el('mark', undefined, match.hit), match.after);
        group.append(row);
      }
      if (doc.count > doc.matches.length) group.append(el('div', 'search-result-limit', '抜粋は先頭100件。↑↓で全件を移動できます。'));
      this.results.append(group);
    }
  }

  private async openResult(path: VPath, match: TextMatch): Promise<void> {
    try {
      await this.opts.openResult?.(path, match, this.query);
      if (!this.destroyed) this.input.focus();
    } catch { this.status.textContent = '該当箇所を開けませんでした。再検索してください。'; }
  }

  private keydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && ['f', 'h'].includes(event.key.toLowerCase())) {
      event.preventDefault(); event.stopPropagation();
      if (event.key.toLowerCase() === 'h') this.setReplaceExpanded(true);
      this.input.focus(); this.input.select(); return;
    }
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (!this.historyList.hidden) this.closeHistory();
      else if (!this.menu.hidden) { this.menu.hidden = true; this.more.setAttribute('aria-expanded', 'false'); this.more.focus(); }
      else this.close();
      return;
    }
    if (!this.historyList.hidden && ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Enter') this.chooseHistory(Math.max(0, this.historyIndex));
      else {
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        this.historyIndex = this.historyIndex < 0 ? delta === 1 ? 0 : this.opts.history.items.length - 1
          : (this.historyIndex + delta + this.opts.history.items.length) % this.opts.history.items.length;
        this.updateHistorySelection();
      }
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault(); event.stopPropagation();
      this.closeHistory();
      const controls = [...this.dom.querySelectorAll<HTMLElement>('input, button, summary')]
        .filter((node) => !node.closest('[hidden]') && !node.hasAttribute('disabled') && node.tabIndex >= 0
          && (node.tagName === 'SUMMARY' || !node.closest('details:not([open])')));
      const at = controls.indexOf(document.activeElement as HTMLElement);
      controls[(at + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); event.stopPropagation();
      (event.shiftKey ? redo : undo)(this.view); return;
    }
    if (event.key === 'Enter' && (event.target === this.input || event.target === this.replacement)) {
      event.preventDefault(); event.stopPropagation(); this.navigate(event.shiftKey ? -1 : 1);
    }
    if (event.key === 'F3') {
      event.preventDefault(); event.stopPropagation(); this.navigate(event.shiftKey ? -1 : 1);
    }
  }

  private readonly onScroll = (): void => this.measureOverlap();
  private measureOverlap(): void {
    if (this.destroyed || !this.dom.isConnected) return;
    this.view.requestMeasure({
      key: this,
      read: () => {
        const panel = this.dom.getBoundingClientRect();
        const selection = this.view.state.selection.main;
        const start = this.view.coordsAtPos(selection.from);
        const end = this.view.coordsAtPos(selection.to);
        const overlaps = !!start && !!end && panel.bottom > Math.min(start.top, end.top)
          && panel.top < Math.max(start.bottom, end.bottom)
          && (start.top !== end.top || (panel.left < Math.max(start.right, end.right) && panel.right > Math.min(start.left, end.left)));
        const scrollbar = Math.max(0, this.view.scrollDOM.offsetWidth - this.view.scrollDOM.clientWidth);
        return { overlaps, scrollbar };
      },
      write: ({ overlaps, scrollbar }) => {
        if (this.destroyed) return;
        this.dom.classList.toggle('overlaps-selection', overlaps);
        this.view.dom.style.setProperty('--search-scrollbar', `${scrollbar}px`);
      },
    });
  }

  private close(): void { this.remember(); closeSearchPanel(this.view); this.view.focus(); }

  destroy(): void {
    this.remember();
    this.destroyed = true;
    this.generation++;
    if (this.searchTimer !== null) clearTimeout(this.searchTimer);
    if (this.historyTimer !== null) clearTimeout(this.historyTimer);
    this.resizeObserver?.disconnect();
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
    this.view.dom.classList.remove('has-floating-search');
    this.view.dom.style.removeProperty('--search-scrollbar');
  }
}
