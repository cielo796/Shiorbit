import { diffHunks, diffLines, diffStats } from '../core/diff/lineDiff';
import type { DiffLine } from '../core/diff/lineDiff';
import { button, el } from './dom';
import { openDialog } from './dialog';

/** どちらを採るか。どれを選んでも、失われる側は必ず .conflict ファイルに残る。 */
export type ConflictChoice = 'mine' | 'theirs' | 'cancel';

export interface ConflictOptions {
  path: string;
  /** 自分の編集内容 */
  mine: string;
  /** 外部で変更された内容 */
  theirs: string;
}

/**
 * 競合の解決（設計書 §9 の3択）。
 *
 * 「どちらを選ぶか」を中身を見ずに決めさせないために、差分を同じ画面に出す。
 * 変更のある場所だけを前後2行つきで見せる — 全文を出すと、
 * 長いノートでは肝心の違いが埋もれるため。
 */
export function resolveConflict(opts: ConflictOptions): Promise<ConflictChoice> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (choice: ConflictChoice): void => {
      if (done) return;
      done = true;
      frame.close();
      resolve(choice);
    };

    const frame = openDialog('変更が競合しています', 'dialog conflict-dialog', () => finish('cancel'));

    const lines = diffLines(opts.theirs, opts.mine);
    const stats = diffStats(lines);

    frame.body.append(
      el('p', 'dialog-message', `「${opts.path}」は他の場所でも変更されています。`),
      el(
        'p',
        'dialog-message',
        stats.added === 0 && stats.removed === 0
          ? '中身は同じです。どちらを選んでも同じ結果になります。'
          : `外部の内容と比べて ${stats.added} 行を追加、${stats.removed} 行を削除しています。`,
      ),
      legend(),
      renderDiff(lines),
      el('p', 'dialog-hint', 'どちらを選んでも、もう一方は .conflict ファイルとして残ります。'),
    );

    frame.footer.append(
      button('キャンセル', undefined, () => finish('cancel')),
      button('外部の内容を読み込む', undefined, () => finish('theirs')),
      button('自分の変更を保存', 'primary', () => finish('mine')),
    );
  });
}

function legend(): HTMLElement {
  const row = el('div', 'diff-legend');
  row.append(
    el('span', 'diff-legend-added', '+ 自分の変更'),
    el('span', 'diff-legend-removed', '− 外部の内容'),
  );
  return row;
}

function renderDiff(lines: readonly DiffLine[]): HTMLElement {
  const host = el('div', 'diff-view');
  const hunks = diffHunks(lines, 2);

  if (hunks.length === 0) {
    host.append(el('div', 'pane-empty', '違いはありません。'));
    return host;
  }

  hunks.forEach((hunk, index) => {
    if (index > 0) host.append(el('div', 'diff-gap', '…'));
    for (const line of hunk) {
      const row = el('div', `diff-line diff-${line.kind}`);
      row.append(
        el('span', 'diff-num', line.leftLine === undefined ? '' : String(line.leftLine)),
        el('span', 'diff-num', line.rightLine === undefined ? '' : String(line.rightLine)),
        el('span', 'diff-mark', line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '),
        el('span', 'diff-text', line.text === '' ? ' ' : line.text),
      );
      host.append(row);
    }
  });

  return host;
}
