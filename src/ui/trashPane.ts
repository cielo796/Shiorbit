import type { TrashEntry } from '../core/vault/trash';
import { button, el } from './dom';

export interface TrashPaneOptions {
  onRestore: (entry: TrashEntry) => void;
  onPurge: (entry: TrashEntry) => void;
  onPurgeAll: () => void;
}

/** ごみ箱の一覧。削除は `.trash/` への移動なので、ここから戻せる。 */
export class TrashPane {
  readonly dom: HTMLElement;
  private readonly list: HTMLElement;
  private entries: TrashEntry[] = [];

  constructor(private readonly opts: TrashPaneOptions) {
    this.dom = el('div', 'trash-pane');
    this.list = el('div', 'sidebar-body');
    this.render();
  }

  setEntries(entries: readonly TrashEntry[]): void {
    this.entries = [...entries];
    this.render();
  }

  private render(): void {
    this.dom.replaceChildren();

    const head = el('div', 'pane-header');
    head.append(
      el('span', undefined, 'ごみ箱'),
      el('span', 'pane-count', String(this.entries.length)),
    );
    if (this.entries.length > 0) {
      head.append(button('すべて消す', 'ghost', () => this.opts.onPurgeAll()));
    }
    this.dom.append(head);

    this.list.replaceChildren();
    if (this.entries.length === 0) {
      this.list.append(el('div', 'pane-empty', 'ごみ箱は空です。削除したノートはここに残ります。'));
    }

    for (const entry of this.entries) {
      const row = el('div', 'trash-row');
      const label = el('div', 'trash-label');
      label.append(
        el('div', 'trash-name', entry.original),
        el('div', 'trash-stamp', `${entry.kind === 'dir' ? 'フォルダ / ' : ''}${readableStamp(entry.stamp)}`),
      );
      row.append(
        label,
        button('戻す', 'ghost', () => this.opts.onRestore(entry)),
        button('消す', 'ghost danger', () => this.opts.onPurge(entry)),
      );
      this.list.append(row);
    }

    this.dom.append(this.list);
  }
}

/** 20260827-153012 → 2026-08-27 15:30 */
function readableStamp(stamp: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(stamp);
  if (!match) return stamp;
  return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
}
