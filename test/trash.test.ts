import { describe, expect, it } from 'vitest';
import { MemoryAdapter } from '../src/adapters/memory';
import { VaultService } from '../src/core/vault/VaultService';
import {
  collectTrashEntries,
  formatTrashStamp,
  freeStamp,
  isInTrash,
  originalPathOf,
  parseTrashRoot,
  trashPathFor,
} from '../src/core/vault/trash';

function newVault(): { adapter: MemoryAdapter; vault: VaultService } {
  const adapter = new MemoryAdapter('Trash');
  return { adapter, vault: new VaultService(adapter, { mtimeToleranceMs: 0 }) };
}

describe('ごみ箱のパス', () => {
  it('名前に元のパスを埋め込む（途中の空フォルダと区別が付くように）', () => {
    expect(trashPathFor('20260827-153012', 'AI/Ollama.md'))
      .toBe('.trash/20260827-153012_AI%2FOllama.md');
    expect(parseTrashRoot('20260827-153012_AI%2FOllama.md'))
      .toEqual({ stamp: '20260827-153012', original: 'AI/Ollama.md' });
    expect(parseTrashRoot('区切りがない')).toBeNull();
  });

  it('元の場所が一意に決まる。山の中のファイルは相対位置を保つ', () => {
    expect(originalPathOf('.trash/20260827-153012_AI%2FOllama.md')).toBe('AI/Ollama.md');
    expect(originalPathOf('.trash/20260827-153012_AI/LLM/Llama.md')).toBe('AI/LLM/Llama.md');
    expect(originalPathOf('AI/Ollama.md')).toBeNull();
    expect(isInTrash('.trash/x_a.md')).toBe(true);
    expect(isInTrash('a.md')).toBe(false);
  });

  it('同じ秒に同じ場所を2回消しても混ざらない', () => {
    const stamp = formatTrashStamp(new Date(2026, 7, 27, 15, 30, 12));
    expect(stamp).toBe('20260827-153012');
    expect(freeStamp(stamp, 'a.md', new Set())).toBe(stamp);
    expect(freeStamp(stamp, 'a.md', new Set([`${stamp}_a.md`]))).toBe(`${stamp}-2`);
    // 別の場所なら同じ時刻のままでよい。
    expect(freeStamp(stamp, 'b.md', new Set([`${stamp}_a.md`]))).toBe(stamp);
  });

  it('一覧は .trash の直下だけを、戻す単位として返す', () => {
    const entries = collectTrashEntries([
      { path: '.trash/2_AI', kind: 'dir' },
      { path: '.trash/2_AI/Ollama.md', kind: 'file' },
      { path: '.trash/1_note.md', kind: 'file' },
      { path: 'AI/keep.md', kind: 'file' },
    ]);
    expect(entries).toEqual([
      { path: '.trash/2_AI', original: 'AI', stamp: '2', kind: 'dir' },
      { path: '.trash/1_note.md', original: 'note.md', stamp: '1', kind: 'file' },
    ]);
  });
});

describe('削除と復元', () => {
  it('ファイルはごみ箱へ移り、実体は残る', async () => {
    const { adapter, vault } = newVault();
    await adapter.write('AI/Ollama.md', '# Ollama');

    const trashed = await vault.moveToTrash('AI/Ollama.md');

    expect(await adapter.exists('AI/Ollama.md')).toBe(false);
    expect(await adapter.read(trashed)).toBe('# Ollama');
    expect(originalPathOf(trashed)).toBe('AI/Ollama.md');
  });

  it('戻すと元の場所に戻る', async () => {
    const { adapter, vault } = newVault();
    await adapter.write('AI/Ollama.md', '# Ollama');

    const trashed = await vault.moveToTrash('AI/Ollama.md');
    const restored = await vault.restoreFromTrash(trashed);

    expect(restored).toBe('AI/Ollama.md');
    expect(await adapter.read('AI/Ollama.md')).toBe('# Ollama');
    expect(await adapter.exists(trashed)).toBe(false);
  });

  it('フォルダは中身ごと移り、中身ごと戻る', async () => {
    const { adapter, vault } = newVault();
    await adapter.write('AI/Ollama.md', 'a');
    await adapter.write('AI/LLM/Llama.md', 'b');

    const trashed = await vault.moveToTrash('AI');
    expect(await adapter.exists('AI/Ollama.md')).toBe(false);
    expect(await adapter.read(`${trashed}/LLM/Llama.md`)).toBe('b');

    await vault.restoreFromTrash(trashed);
    expect(await adapter.read('AI/Ollama.md')).toBe('a');
    expect(await adapter.read('AI/LLM/Llama.md')).toBe('b');
  });

  it('同じ名前が既にあるときは上書きせずに断る', async () => {
    const { adapter, vault } = newVault();
    await adapter.write('note.md', '古い');

    const trashed = await vault.moveToTrash('note.md');
    await adapter.write('note.md', '新しい');

    await expect(vault.restoreFromTrash(trashed)).rejects.toThrow();
    expect(await adapter.read('note.md')).toBe('新しい');
    expect(await adapter.exists(trashed)).toBe(true);
  });

  it('一覧に出て、完全削除で消える', async () => {
    const { adapter, vault } = newVault();
    await adapter.write('a.md', 'a');
    await adapter.write('b.md', 'b');

    const first = await vault.moveToTrash('a.md');
    await vault.moveToTrash('b.md');
    expect((await vault.listTrash()).map((entry) => entry.original).sort()).toEqual(['a.md', 'b.md']);

    await vault.purgeTrash(first);
    expect((await vault.listTrash()).map((entry) => entry.original)).toEqual(['b.md']);

    await vault.purgeTrash();
    expect(await vault.listTrash()).toEqual([]);
  });

  it('ごみ箱の外を完全削除しようとしたら断る', async () => {
    const { adapter, vault } = newVault();
    await adapter.write('keep.md', 'keep');

    await expect(vault.purgeTrash('keep.md')).rejects.toThrow();
    expect(await adapter.read('keep.md')).toBe('keep');
  });

  it('ごみ箱は隠しフォルダなので一覧に出ない', async () => {
    const { adapter, vault } = newVault();
    await adapter.write('a.md', 'a');
    await vault.moveToTrash('a.md');

    expect(await vault.listAll()).toEqual([]);
    expect(await vault.listDocumentTree()).toEqual([]);
  });
});
