import { el } from './dom';

const VISIBLE_MS = 6000;

/** 画面の隅に短く出す通知。失敗も成功もここに集める。 */
export class Toaster {
  readonly dom: HTMLElement;

  constructor() {
    this.dom = el('div', 'toast-host');
  }

  show(message: string, isError = false): void {
    const node = el('div', isError ? 'toast error' : 'toast', message);
    this.dom.append(node);
    setTimeout(() => node.remove(), VISIBLE_MS);
  }
}
