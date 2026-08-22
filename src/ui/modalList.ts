import { el, highlight } from './dom';

export interface ModalItem {
  id: string;
  title: string;
  subtitle?: string;
  /** 右端に出す補足 (ホットキーなど) */
  hint?: string;
  className?: string;
}

export interface ModalListOptions {
  placeholder: string;
  /** 入力に応じた候補。空文字のときは全件を返す想定。 */
  items: (query: string) => ModalItem[];
  onSelect: (item: ModalItem, query: string) => void;
  emptyMessage?: string;
}

/**
 * 検索欄つきモーダル一覧。
 * クイックスイッチャとコマンドパレットで同じ実装を使い、操作感を揃える。
 */
export class ModalList {
  private overlay: HTMLElement | null = null;
  private input: HTMLInputElement | null = null;
  private list: HTMLElement | null = null;
  private current: ModalItem[] = [];
  private cursor = 0;

  constructor(private readonly opts: ModalListOptions) {}

  get isOpen(): boolean {
    return this.overlay !== null;
  }

  open(): void {
    if (this.overlay) {
      this.input?.focus();
      this.input?.select();
      return;
    }

    const overlay = el('div', 'modal-overlay');
    const modal = el('div', 'modal');
    const input = el('input', 'modal-input');
    input.type = 'text';
    input.placeholder = this.opts.placeholder;
    const list = el('div', 'modal-list');

    modal.append(input, list);
    overlay.append(modal);
    document.body.append(overlay);

    this.overlay = overlay;
    this.input = input;
    this.list = list;

    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) this.close();
    });
    input.addEventListener('input', () => this.update());
    input.addEventListener('keydown', (e) => this.onKey(e));

    this.update();
    input.focus();
  }

  close(): void {
    this.overlay?.remove();
    this.overlay = null;
    this.input = null;
    this.list = null;
    this.current = [];
    this.cursor = 0;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault();
      this.move(1);
      return;
    }
    if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault();
      this.move(-1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      this.commit();
    }
  }

  private move(delta: number): void {
    if (this.current.length === 0) return;
    this.cursor = (this.cursor + delta + this.current.length) % this.current.length;
    this.render();
  }

  private commit(): void {
    const item = this.current[this.cursor];
    if (!item) return;
    const query = (this.input?.value ?? '').trim();
    this.close();
    this.opts.onSelect(item, query);
  }

  private update(): void {
    this.current = this.opts.items((this.input?.value ?? '').trim()).slice(0, 100);
    this.cursor = 0;
    this.render();
  }

  private render(): void {
    const list = this.list;
    if (!list) return;
    list.replaceChildren();

    const query = (this.input?.value ?? '').trim();
    const terms = query === '' ? [] : [query];

    if (this.current.length === 0) {
      list.append(el('div', 'pane-empty', this.opts.emptyMessage ?? '候補がありません'));
      return;
    }

    this.current.forEach((item, i) => {
      const classes = ['modal-row'];
      if (i === this.cursor) classes.push('selected');
      if (item.className) classes.push(item.className);
      const row = el('div', classes.join(' '));

      const head = el('div', 'modal-row-head');
      const title = el('div', 'modal-row-title');
      title.append(highlight(item.title, terms));
      head.append(title);
      if (item.hint) head.append(el('span', 'modal-row-hint', item.hint));
      row.append(head);

      if (item.subtitle) row.append(el('div', 'modal-row-path', item.subtitle));

      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.cursor = i;
        this.commit();
      });
      list.append(row);
    });

    list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  }
}
