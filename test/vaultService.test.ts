import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryAdapter } from '../src/adapters/memory';
import { VaultService, type VaultEvent } from '../src/core/vault/VaultService';
import { ConflictError } from '../src/core/vault/errors';

/**
 * 合格判定 (設計書 §13.5)
 *
 * これらのテストはブラウザもファイルシステムも使わない。
 * MemoryAdapter を差し込むだけでコアが完全に動く = 境界が正しく引けている。
 */
describe('VaultService', () => {
  let adapter: MemoryAdapter;
  let vault: VaultService;

  beforeEach(() => {
    adapter = new MemoryAdapter('TestVault');
    // 許容誤差 0 で厳密に競合を判定する
    vault = new VaultService(adapter, { mtimeToleranceMs: 0 });
  });

  it('ブラウザ環境なしで動作する', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
    expect(vault.name).toBe('TestVault');
    expect(vault.id).toBe('memory');
  });

  it('listAll が隠しフォルダを除外し、ディレクトリを先に並べる', async () => {
    await adapter.write('b.md', '');
    await adapter.write('AI/a.md', '');
    await adapter.write('.shiorbit/cache.json', '');

    const paths = (await vault.listAll()).map((e) => e.path);
    expect(paths).toEqual(['AI', 'AI/a.md', 'b.md']);
  });

  it('listNotes が .md だけを返す', async () => {
    await adapter.write('a.md', '');
    await adapter.write('img.png', '');
    expect((await vault.listNotes()).map((e) => e.path)).toEqual(['a.md']);
  });

  it('readNote が本文と mtime を返す', async () => {
    await adapter.write('a.md', 'hello');
    const note = await vault.readNote('a.md');
    expect(note.text).toBe('hello');
    expect(note.mtime).toBeGreaterThan(0);
  });

  it('自分が読んだ後の保存は通る', async () => {
    await adapter.write('a.md', 'v1');
    const note = await vault.readNote('a.md');
    const mtime = await vault.writeNote('a.md', 'v2', note.mtime);
    expect(await adapter.read('a.md')).toBe('v2');
    expect(mtime).toBeGreaterThan(note.mtime);
  });

  it('外部で変更されたファイルの上書きは ConflictError で止まる', async () => {
    await adapter.write('a.md', 'v1');
    const note = await vault.readNote('a.md');

    // 別のアプリ (Git pull やクラウド同期) が書き換えた状況
    await adapter.write('a.md', 'external');

    await expect(vault.writeNote('a.md', 'mine', note.mtime)).rejects.toBeInstanceOf(ConflictError);
    // 上書きされていないこと
    expect(await adapter.read('a.md')).toBe('external');
  });

  it('baseMtime を渡さなければ強制上書きできる', async () => {
    await adapter.write('a.md', 'v1');
    await vault.overwriteNote('a.md', 'forced');
    expect(await adapter.read('a.md')).toBe('forced');
  });

  it('saveConflictCopy が失われる側を必ずファイルとして残す', async () => {
    await adapter.write('AI/a.md', 'v1');
    const backup = await vault.saveConflictCopy('AI/a.md', 'mine');

    expect(backup).toMatch(/^AI\/a\.conflict-\d{8}-\d{4}\.md$/);
    expect(await adapter.read(backup)).toBe('mine');
    expect(await adapter.read('AI/a.md')).toBe('v1');
  });

  it('createNote が既存ノートを壊さない', async () => {
    await adapter.write('a.md', 'v1');
    await expect(vault.createNote('a.md', 'new')).rejects.toBeInstanceOf(ConflictError);
    expect(await adapter.read('a.md')).toBe('v1');
  });

  it('poll が外部の作成・変更・削除を検知する', async () => {
    await adapter.write('a.md', 'v1');
    expect(await vault.poll()).toEqual([{ type: 'create', path: 'a.md' }]);
    expect(await vault.poll()).toEqual([]);

    await adapter.write('a.md', 'v2');
    expect(await vault.poll()).toEqual([{ type: 'modify', path: 'a.md' }]);

    await adapter.remove('a.md');
    expect(await vault.poll()).toEqual([{ type: 'delete', path: 'a.md' }]);
  });

  it('イベントが購読者に配信され、解除できる', async () => {
    const seen: VaultEvent[] = [];
    const off = vault.on((ev) => seen.push(ev));

    await vault.createNote('a.md', '');
    await vault.remove('a.md');
    off();
    await vault.createNote('b.md', '');

    expect(seen).toEqual([
      { type: 'create', path: 'a.md' },
      { type: 'delete', path: 'a.md' },
    ]);
  });
});
