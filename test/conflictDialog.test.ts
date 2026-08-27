// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  conflictPathFor,
  conflictStamp,
  formatConflictStamp,
  isConflictCopy,
  originalOfConflict,
} from '../src/core/vault/conflict';
import { resolveConflict } from '../src/ui/conflictDialog';

function click(label: string): void {
  const dialog = document.querySelector('.conflict-dialog')!;
  const target = [...dialog.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent === label);
  expect(target, `「${label}」が見つからない`).toBeDefined();
  target!.click();
}

describe('競合ファイルの名前', () => {
  it('拡張子の前に印を入れる', () => {
    expect(conflictPathFor('AI/Ollama.md', '20260827-1530')).toBe('AI/Ollama.conflict-20260827-1530.md');
    expect(conflictPathFor('AI/README', '20260827-1530')).toBe('AI/README.conflict-20260827-1530');
  });

  it('名前だけで見分けられる', () => {
    expect(isConflictCopy('AI/Ollama.conflict-20260827-1530.md')).toBe(true);
    expect(isConflictCopy('AI/Ollama.md')).toBe(false);
    // 紛らわしいだけの名前は拾わない。
    expect(isConflictCopy('AI/conflict-notes.md')).toBe(false);
  });

  it('退避元と時刻を取り出せる', () => {
    const path = conflictPathFor('AI/Ollama.md', formatConflictStamp(new Date(2026, 7, 27, 15, 30)));
    expect(originalOfConflict(path)).toBe('AI/Ollama.md');
    expect(conflictStamp(path)).toBe('20260827-1530');
    expect(originalOfConflict('AI/Ollama.md')).toBeNull();
  });
});

describe('競合の解決ダイアログ', () => {
  it('差分を見せ、選んだ側を返す', async () => {
    const pending = resolveConflict({
      path: 'note.md',
      mine: ['# note', '', '一行目', '自分が足した行'].join('\n'),
      theirs: ['# note', '', '一行目', '外部で足した行'].join('\n'),
    });

    const dialog = document.querySelector('.conflict-dialog')!;
    expect(dialog.textContent).toContain('「note.md」は他の場所でも変更されています');
    expect(dialog.textContent).toContain('1 行を追加、1 行を削除');

    const added = [...dialog.querySelectorAll('.diff-added .diff-text')].map((n) => n.textContent);
    const removed = [...dialog.querySelectorAll('.diff-removed .diff-text')].map((n) => n.textContent);
    expect(added).toEqual(['自分が足した行']);
    expect(removed).toEqual(['外部で足した行']);
    // 変わっていない行は前後の文脈として出る。
    expect(dialog.querySelectorAll('.diff-same').length).toBeGreaterThan(0);

    click('自分の変更を保存');
    await expect(pending).resolves.toBe('mine');
    expect(document.querySelector('.conflict-dialog')).toBeNull();
  });

  it('外部の内容を選べる', async () => {
    const pending = resolveConflict({ path: 'a.md', mine: 'A', theirs: 'B' });
    click('外部の内容を読み込む');
    await expect(pending).resolves.toBe('theirs');
  });

  it('Esc で取り消せる（どちらも保存しない）', async () => {
    const pending = resolveConflict({ path: 'a.md', mine: 'A', theirs: 'B' });
    document.querySelector('.modal-overlay')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect(pending).resolves.toBe('cancel');
  });

  it('中身が同じなら、そう伝える', async () => {
    const pending = resolveConflict({ path: 'a.md', mine: 'same\n', theirs: 'same\n' });
    expect(document.querySelector('.conflict-dialog')!.textContent).toContain('中身は同じです');
    click('キャンセル');
    await pending;
  });
});
