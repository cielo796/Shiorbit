import type { VPath } from '../core/vault/types';
import type { SearchResult } from '../core/index/Indexer';
import { el, highlight, noteLabel } from './dom';

export interface SearchPaneOptions {
  search: (query: string) => Promise<SearchResult[]>;
  /** 抜粋は表示された行のぶんだけ取りに行く（ROADMAP 7.5） */
  snippet: (path: VPath, query: string) => Promise<string>;
  onOpen: (path: VPath) => void;
}

const DEBOUNCE_MS = 180;
/** 最初に抜粋を出す件数。スクロールしたぶんだけ増やす。 */
const SNIPPET_BATCH = 10;

export class SearchPane {
  readonly dom: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly results: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  /** まだ抜粋を入れていない行 */
  private pending: Array<{ path: VPath; host: HTMLElement }> = [];
  private filled = 0;

  constructor(private readonly opts: SearchPaneOptions) {
    this.dom = el('div', 'sidebar-body search-pane');

    const box = el('div', 'search-box');
    this.input = el('input', 'search-input');
    this.input.type = 'search';
    this.input.placeholder = 'Vault 内を検索';
    this.input.addEventListener('input', () => this.schedule());
    box.append(this.input);

    this.results = el('div', 'search-results');
    this.results.addEventListener('scroll', () => this.fillMore());
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

    const terms = query.split(/\s+/).filter((term) => term !== '');
    this.results.replaceChildren();
    this.results.append(el('div', 'pane-note', `${hits.length} 件`));
    this.pending = [];
    this.filled = 0;

    for (const hit of hits) {
      const row = el('div', 'search-result');
      const title = el('div', 'search-title');
      title.append(highlight(hit.title, terms));
      const snippet = el('div', 'search-snippet');

      row.append(title, el('div', 'search-path', hit.path), snippet);
      row.addEventListener('click', () => this.opts.onOpen(hit.path));
      this.results.append(row);
      this.pending.push({ path: hit.path, host: snippet });
    }

    await this.fillMore(query, terms, seq);
  }

  /** 見えているぶんの抜粋を埋める。読み込みは1行1回だけ。 */
  private async fillMore(query?: string, terms?: string[], seq?: number): Promise<void> {
    const current = query ?? this.input.value.trim();
    const words = terms ?? current.split(/\s+/).filter((term) => term !== '');
    const mySeq = seq ?? this.seq;
    if (current === '' || this.filled >= this.pending.length) return;

    const until = Math.min(this.pending.length, this.filled + SNIPPET_BATCH);
    const rows = this.pending.slice(this.filled, until);
    this.filled = until;

    for (const row of rows) {
      const text = await this.opts.snippet(row.path, current);
      // 新しい検索に追い越されていたら、古い抜粋を描かない。
      if (mySeq !== this.seq || !row.host.isConnected) return;
      row.host.replaceChildren(highlight(text, words));
    }
  }

  private renderEmpty(message: string): void {
    this.results.replaceChildren(el('div', 'pane-empty', message));
  }
}

/** 表示用ヘルパ (外からも使えるように) */
export { noteLabel };
