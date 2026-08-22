import { StateEffect, type EditorState } from '@codemirror/state';
import type { ViewUpdate } from '@codemirror/view';

/**
 * 装飾を引き直せ、という合図。
 * インデックス更新や設定変更のように、本文が変わらないのに見た目が変わる場面で使う。
 */
export const refreshPreview = StateEffect.define<null>();

export function wasNudged(update: ViewUpdate): boolean {
  return update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshPreview)));
}

export function shouldRecompute(update: ViewUpdate): boolean {
  return update.docChanged || update.viewportChanged || update.selectionSet || wasNudged(update);
}

/**
 * カーソル（または選択範囲）が乗っている行の番号。
 *
 * この行だけは記法を隠さず生の Markdown を見せる。
 * 「要素単位で出し入れする」やり方より予測しやすく、
 * 入力中にちらつかないので、まずはこの粒度で作る (設計書 §7)。
 */
export function revealedLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return lines;
}

export function isRevealed(state: EditorState, revealed: Set<number>, pos: number): boolean {
  return revealed.has(state.doc.lineAt(pos).number);
}
