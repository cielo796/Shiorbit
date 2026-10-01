import { conflictStamp, originalOfConflict } from '../core/vault/conflict';
import type { TrashEntry } from '../core/vault/trash';
import type { VPath } from '../core/vault/types';
import { button, el } from './dom';

export interface CleanupPaneOptions {
  onRestore: (entry: TrashEntry) => void;
  onPurge: (entry: TrashEntry) => void;
  onPurgeAll: () => void;
  onOpenConflict: (path: VPath) => void;
  onDeleteConflict: (path: VPath) => void;
  onDeleteAllConflicts: () => void;
}

/**
 * 後始末が要るファイルをまとめて置く場所。
 *
 * ごみ箱（削除は `.trash/` への移動）と、競合で退避した `.conflict-*` は
 * どちらも「放っておくと溜まる」ものなので、片付け導線を1か所にする。
 */
export class CleanupPane {
  readonly dom: HTMLElement;
  private entries: TrashEntry[] = [];
  private conflicts: VPath[] = [];

  constructor(private readonly opts: CleanupPaneOptions) {
    this.dom = el('div', 'cleanup-pane');
    this.render();
  }

  setEntries(entries: readonly TrashEntry[]): void {
    this.entries = [...entries];
    this.render();
  }

  setConflicts(paths: readonly VPath[]): void {
    this.conflicts = [...paths];
    this.render();
  }

  private render(): void {
    this.dom.replaceChildren();
    this.dom.append(this.renderTrash(), this.renderConflicts());
  }

  private renderTrash(): HTMLElement {
    const section = el('section', 'pane-section');
    const head = el('div', 'pane-header');
    head.append(el('span', undefined, 'ごみ箱'), el('span', 'pane-count', String(this.entries.length)));
    if (this.entries.length > 0) {
      head.append(button('すべて消す', 'ghost', () => this.opts.onPurgeAll()));
    }
    section.append(head);

    if (this.entries.length === 0) {
      section.append(el('div', 'pane-empty', 'ごみ箱は空です。削除したノートはここに残ります。'));
      return section;
    }

    for (const entry of this.entries) {
      const row = el('div', 'cleanup-row');
      const label = el('div', 'cleanup-label');
      label.append(
        el('div', 'cleanup-name', entry.original),
        el('div', 'cleanup-note', `${entry.kind === 'dir' ? 'フォルダ / ' : ''}${readableStamp(entry.stamp)}`),
      );
      row.append(
        label,
        button('戻す', 'ghost', () => this.opts.onRestore(entry)),
        button('消す', 'ghost danger', () => this.opts.onPurge(entry)),
      );
      section.append(row);
    }
    return section;
  }

  private renderConflicts(): HTMLElement {
    const section = el('section', 'pane-section');
    const head = el('div', 'pane-header');
    head.append(el('span', undefined, '競合ファイル'), el('span', 'pane-count', String(this.conflicts.length)));
    if (this.conflicts.length > 0) {
      head.append(button('解決済みを削除', 'ghost', () => this.opts.onDeleteAllConflicts()));
    }
    section.append(head);

    if (this.conflicts.length === 0) {
      section.append(el('div', 'pane-empty', '退避したファイルはありません。'));
      return section;
    }

    for (const path of this.conflicts) {
      const row = el('div', 'cleanup-row');
      const label = el('div', 'cleanup-label');
      label.append(
        el('div', 'cleanup-name', originalOfConflict(path) ?? path),
        el('div', 'cleanup-note', readableStamp(conflictStamp(path))),
      );
      label.title = path;
      row.append(
        label,
        button('開く', 'ghost', () => this.opts.onOpenConflict(path)),
        button('消す', 'ghost danger', () => this.opts.onDeleteConflict(path)),
      );
      section.append(row);
    }
    return section;
  }
}

/** 20260827-153012 / 20260827-1530 → 2026-08-27 15:30 */
function readableStamp(stamp: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(stamp);
  if (!match) return stamp;
  return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
}
