import { basename } from '../core/vault/path';
import type { VPath } from '../core/vault/types';
import { el } from './dom';

export interface TabStripOptions {
  onSelect: (path: VPath) => void;
  onClose: (path: VPath) => void;
}

export interface TabState {
  path: VPath;
  /** 未保存のしるしを出す */
  dirty: boolean;
}

/**
 * 開いているドキュメントの帯（設計書 §8）。
 *
 * 中身は持たない。順番と「どれが選ばれているか」を DocumentPane から流し込む。
 */
export class TabStrip {
  readonly dom: HTMLElement;

  constructor(private readonly opts: TabStripOptions) {
    this.dom = el('div', 'tab-strip');
    this.dom.setAttribute('role', 'tablist');
    this.dom.style.display = 'none';
  }

  setTabs(tabs: readonly TabState[], active: VPath | null): void {
    this.dom.replaceChildren();
    // 1枚だけのときは帯を出さない。何も選べないので場所の無駄になる。
    this.dom.style.display = tabs.length <= 1 ? 'none' : '';

    for (const tab of tabs) {
      const item = el('div', 'tab-item');
      item.setAttribute('role', 'tab');
      item.title = tab.path;
      if (tab.path === active) item.classList.add('active');
      if (tab.dirty) item.classList.add('dirty');

      const label = el('span', 'tab-label', basename(tab.path, true) || tab.path);
      const close = el('button', 'tab-close', '✕');
      close.type = 'button';
      close.title = '閉じる';
      close.addEventListener('click', (event) => {
        event.stopPropagation();
        this.opts.onClose(tab.path);
      });

      item.append(label, close);
      item.addEventListener('mousedown', (event) => {
        // 中クリックで閉じる（ブラウザのタブと同じ）。
        if (event.button === 1) {
          event.preventDefault();
          this.opts.onClose(tab.path);
        } else if (event.button === 0) {
          this.opts.onSelect(tab.path);
        }
      });
      this.dom.append(item);
    }
  }
}
