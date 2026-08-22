import type { VPath } from '../core/vault/types';
import type { SearchResult } from '../core/index/Indexer';
import { el, highlight, noteLabel } from './dom';

export interface SearchPaneOptions {
  search: (query: string) => Promise<SearchResult[]>;
  onOpen: (path: VPath) => void;
}

const DEBOUNCE_MS = 180;

export class SearchPane {
  readonly dom: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly results: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  constructor(private readonly opts: SearchPaneOptions) {
    this.dom = el('div', 'sidebar-body search-pane');

    const box = el('div', 'search-box');
    this.input = el('input', 'search-input');
    this.input.type = 'search';
    this.input.placeholder = 'Vault 内を検索';
    this.input.addEventListener('input', () => this.schedule());
    box.append(this.input);

    this.results = el('div', 'search-results');
    this.dom.append(box, this.results);
    this.renderEmpty('検索語を入力してください');
  }

  focus(): void {
    this.input.focus();
    this.input.select();
  }

  /** インデックスが更新されたら結果を取り直す */
  refresh(): void {
    if (this.input.value.trim() !== '') this.schedule();
  }

  private schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), DEBOUNCE_MS);
  }

  private async run(): Promise<void> {
    const query = this.input.value.trim();
    const seq = ++this.seq;

    if (query === '') {
      this.renderEmpty('検索語を入力してください');
      return;
    }

    const hits = await this.opts.search(query);
    if (seq !== this.seq) return; // 新しい入力に追い越された

    if (hits.length === 0) {
      this.renderEmpty(`「${query}」に一致するノートはありません`);
      return;
    }

    const terms = query.split(/\s+/).filter((t) => t !== '');
    this.results.replaceChildren();
    this.results.append(el('div', 'pane-note', `${hits.length} 件`));

    for (const hit of hits) {
      const row = el('div', 'search-result');
      const title = el('div', 'search-title');
      title.append(highlight(hit.title, terms));
      const path = el('div', 'search-path', hit.path);
      const snippet = el('div', 'search-snippet');
      snippet.append(highlight(hit.snippet, terms));

      row.append(title, path, snippet);
      row.addEventListener('click', () => this.opts.onOpen(hit.path));
      this.results.append(row);
    }
  }

  private renderEmpty(message: string): void {
    this.results.replaceChildren(el('div', 'pane-empty', message));
  }
}

/** 表示用ヘルパ (外からも使えるように) */
export { noteLabel };
