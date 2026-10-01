import { basename } from '../core/vault/path';
import type { VPath } from '../core/vault/types';
import { el } from './dom';

export interface TabStripOptions {
  onSelect: (path: VPath) => void;
  onClose: (path: VPath) => void;
  /** 右クリック。画面座標をそのまま渡す。 */
  onMenu: (path: VPath, x: number, y: number) => void;
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
  private readonly items = new Map<VPath, HTMLElement>();

  constructor(private readonly opts: TabStripOptions) {
    this.dom = el('div', 'tab-strip');
    this.dom.setAttribute('role', 'tablist');
    this.dom.style.display = 'none';
  }

  setTabs(tabs: readonly TabState[], active: VPath | null): void {
    const paths = new Set(tabs.map((tab) => tab.path));
    for (const [path, item] of this.items) {
      if (!paths.has(path)) {
        item.remove();
        this.items.delete(path);
      }
    }
    // 1枚だけのときは帯を出さない。何も選べないので場所の無駄になる。
    this.dom.style.display = tabs.length <= 1 ? 'none' : '';

    tabs.forEach((tab, index) => {
      let item = this.items.get(tab.path);
      if (!item) {
        item = this.createItem(tab.path);
        this.items.set(tab.path, item);
      }
      item.classList.toggle('active', tab.path === active);
      item.classList.toggle('dirty', tab.dirty);
      item.setAttribute('aria-selected', String(tab.path === active));

      // 保存状態の更新やペインのフォーカス変更では、押しているボタンを
      // 取り外さない。mousedown と click の間の更新でも同じ要素を保つ。
      const current = this.dom.children[index] ?? null;
      if (current !== item) this.dom.insertBefore(item, current);
    });
  }

  private createItem(path: VPath): HTMLElement {
    const item = el('div', 'tab-item');
    item.setAttribute('role', 'tab');
    item.title = path;
    const label = el('span', 'tab-label', basename(path, true) || path);
    const close = el('button', 'tab-close', '✕');
    close.type = 'button';
    close.title = '閉じる';
    close.setAttribute('aria-label', `${path} を閉じる`);
    close.addEventListener('mousedown', (event) => {
      // click の伝播を止めるだけでは、先行するタブ選択を防げない。
      // 中クリックは親の既存の「閉じる」処理に任せる。
      if (event.button === 0) event.stopPropagation();
    });
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      this.opts.onClose(path);
    });

    item.append(label, close);
    item.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.opts.onMenu(path, event.clientX, event.clientY);
    });
    item.addEventListener('mousedown', (event) => {
      // 中クリックで閉じる（ブラウザのタブと同じ）。
      if (event.button === 1) {
        event.preventDefault();
        this.opts.onClose(path);
      } else if (event.button === 0) {
        this.opts.onSelect(path);
      }
    });
    return item;
  }
}
