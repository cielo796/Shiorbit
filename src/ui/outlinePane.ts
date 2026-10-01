import type { Heading } from '../core/markdown/scan';
import { el } from './dom';

export interface OutlinePaneOptions {
  onReveal: (offset: number) => void;
}

/** 現在の文書の見出しを表示し、クリック位置とスクロール位置を同期する。 */
export class OutlinePane {
  readonly dom: HTMLElement;
  private readonly list: HTMLElement;
  private headings: Heading[] = [];
  private currentOffset = 0;
  private activeOffset: number | null = null;
  private readonly items = new Map<number, HTMLElement>();

  constructor(private readonly opts: OutlinePaneOptions) {
    this.dom = el('section', 'pane-section pane-outline');
    this.list = el('div', 'outline-list');
    this.list.setAttribute('role', 'tree');
    this.render();
  }

  setHeadings(headings: Heading[]): void {
    if (headings.length === this.headings.length && headings.every((h, i) => {
      const old = this.headings[i]!;
      return h.offset === old.offset && h.text === old.text && h.level === old.level;
    })) return;
    this.headings = [...headings];
    this.render();
  }

  setCurrentOffset(offset: number): void {
    this.currentOffset = Math.max(0, offset);
    this.syncActive();
  }

  private render(): void {
    this.dom.replaceChildren();
    this.items.clear();
    this.activeOffset = null;

    const header = el('div', 'pane-header');
    header.append(el('span', undefined, 'アウトライン'), el('span', 'pane-count', String(this.headings.length)));
    this.dom.append(header);
    this.list.replaceChildren();

    if (this.headings.length === 0) {
      this.list.append(el('div', 'pane-empty', '見出しはありません'));
    } else {
      for (const heading of this.headings) {
        const item = el('div', 'outline-item', heading.text || '(無題の見出し)');
        item.setAttribute('role', 'treeitem');
        item.setAttribute('aria-level', String(heading.level));
        item.setAttribute('aria-current', 'false');
        item.tabIndex = 0;
        item.title = heading.text;
        item.style.setProperty('--outline-level', String(Math.max(0, heading.level - 1)));
        item.addEventListener('click', () => this.reveal(heading.offset));
        item.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          this.reveal(heading.offset);
        });
        this.items.set(heading.offset, item);
        this.list.append(item);
      }
    }

    this.dom.append(this.list);
    this.syncActive();
  }

  private reveal(offset: number): void {
    this.setCurrentOffset(offset);
    this.opts.onReveal(offset);
  }

  private syncActive(): void {
    let lo = 0, hi = this.headings.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.headings[mid]!.offset <= this.currentOffset) lo = mid + 1;
      else hi = mid;
    }
    const next = this.headings[lo - 1]?.offset ?? null;
    if (next === this.activeOffset) return;
    const oldItem = this.activeOffset === null ? undefined : this.items.get(this.activeOffset);
    oldItem?.classList.remove('active');
    oldItem?.setAttribute('aria-current', 'false');
    this.activeOffset = next;
    const item = next === null ? undefined : this.items.get(next);
    item?.classList.add('active');
    item?.setAttribute('aria-current', 'location');
  }
}
