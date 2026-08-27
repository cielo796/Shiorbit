import { describe, expect, it } from 'vitest';
import { diffHunks, diffLines, diffStats } from '../src/core/diff/lineDiff';

function render(left: string, right: string): string[] {
  return diffLines(left, right).map((line) => {
    const mark = line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' ';
    return `${mark}${line.text}`;
  });
}

describe('行の差分', () => {
  it('同じなら差分は出ない', () => {
    expect(render('a\nb\nc', 'a\nb\nc')).toEqual([' a', ' b', ' c']);
    expect(diffStats(diffLines('a\nb', 'a\nb'))).toEqual({ added: 0, removed: 0 });
  });

  it('真ん中の1行だけが置き換わる', () => {
    expect(render('a\nb\nc', 'a\nB\nc')).toEqual([' a', '-b', '+B', ' c']);
  });

  it('追加と削除を数える', () => {
    const lines = diffLines('a\nb\nc', 'a\nx\ny\nc');
    expect(diffStats(lines)).toEqual({ added: 2, removed: 1 });
  });

  it('片方が空でも壊れない', () => {
    expect(render('', 'a\nb')).toEqual(['-', '+a', '+b']);
    expect(render('a\nb', '')).toEqual(['-a', '-b', '+']);
  });

  it('行番号を両側に振る', () => {
    const lines = diffLines('a\nb\nc', 'a\nB\nc');
    expect(lines[0]).toEqual({ kind: 'same', text: 'a', leftLine: 1, rightLine: 1 });
    expect(lines[1]).toEqual({ kind: 'removed', text: 'b', leftLine: 2 });
    expect(lines[2]).toEqual({ kind: 'added', text: 'B', rightLine: 2 });
    expect(lines[3]).toEqual({ kind: 'same', text: 'c', leftLine: 3, rightLine: 3 });
  });

  it('改行コードの違いだけでは差分にしない', () => {
    expect(diffStats(diffLines('a\r\nb\r\n', 'a\nb\n'))).toEqual({ added: 0, removed: 0 });
  });

  it('末尾の改行の有無で余計な行を作らない', () => {
    expect(render('a\nb\n', 'a\nb')).toEqual([' a', ' b']);
  });

  it('共通部分を保ったまま差し替える（先頭と末尾を削ってから突き合わせる）', () => {
    const left = ['見出し', '', '本文1', '本文2', '', '締め'].join('\n');
    const right = ['見出し', '', '本文1', '本文2改', '追記', '', '締め'].join('\n');
    expect(render(left, right)).toEqual([
      ' 見出し', ' ', ' 本文1', '-本文2', '+本文2改', '+追記', ' ', ' 締め',
    ]);
  });

  it('変更のある場所だけを前後の行つきで抜き出す', () => {
    const left = Array.from({ length: 20 }, (_, i) => `行${i}`).join('\n');
    const right = left.replace('行10', '行10改');
    const hunks = diffHunks(diffLines(left, right), 2);

    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.map((line) => line.text)).toEqual([
      '行8', '行9', '行10', '行10改', '行11', '行12',
    ]);
  });

  it('離れた変更は別のまとまりになる', () => {
    const left = Array.from({ length: 30 }, (_, i) => `行${i}`).join('\n');
    const right = left.replace('行2\n', '').replace('行25', '行25改');
    expect(diffHunks(diffLines(left, right), 1)).toHaveLength(2);
  });

  it('まったく違う文書でも落ちない', () => {
    const lines = diffLines('a\nb\nc', 'x\ny\nz');
    expect(diffStats(lines)).toEqual({ added: 3, removed: 3 });
  });
});
