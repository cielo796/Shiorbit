import { el } from './dom';

export type NavTarget = 'files' | 'search' | 'tags' | 'unresolved' | 'graph';

export interface MobileNavOptions {
  onSelect: (target: NavTarget) => void;
}

const ITEMS: { id: NavTarget; icon: string; label: string }[] = [
  { id: 'files', icon: '📁', label: 'ファイル' },
  { id: 'search', icon: '🔍', label: '検索' },
  { id: 'tags', icon: '🏷', label: 'タグ' },
  { id: 'unresolved', icon: '◌', label: '未解決' },
  { id: 'graph', icon: '◍', label: 'グラフ' },
];

/**
 * スマホ用のボトムナビ（設計書 §8）。
 * 画面が狭いと右ペインもサイドバーも常時は置けないので、ここから呼び出す。
 */
export class MobileNav {
  readonly dom: HTMLElement;
  private readonly buttons = new Map<NavTarget, HTMLButtonElement>();

  constructor(opts: MobileNavOptions) {
    this.dom = el('nav', 'mobile-nav');
    for (const item of ITEMS) {
      const b = el('button', 'nav-item');
      b.type = 'button';
      b.title = item.label;
      b.append(el('span', 'nav-icon', item.icon), el('span', 'nav-label', item.label));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.onSelect(item.id);
      });
      this.buttons.set(item.id, b);
      this.dom.append(b);
    }
  }

  setActive(target: NavTarget | null): void {
    for (const [id, b] of this.buttons) b.classList.toggle('active', id === target);
  }
}
