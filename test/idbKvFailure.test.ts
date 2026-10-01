import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/adapters/idb', () => ({
  STORE_KV: 'kv', idbPut: vi.fn(), idbGet: vi.fn(), idbDelete: vi.fn(),
}));
import { idbDelete, idbPut } from '../src/adapters/idb';
import { IdbKeyValueStore } from '../src/adapters/idbKv';
afterEach(() => vi.restoreAllMocks());

describe('IndexedDBの保存失敗', () => {
  it('保存失敗をIndexerへ伝え、旧索引の削除に進ませない', async () => {
    const error = new Error('Quota exceeded');
    vi.mocked(idbPut).mockRejectedValueOnce(error);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(new IdbKeyValueStore().set('index:v6:Vault', {})).rejects.toBe(error);
  });

  it('削除失敗をIndexerへ伝え、旧索引の整理を再試行できる', async () => {
    const error = new Error('Delete failure');
    vi.mocked(idbDelete).mockRejectedValueOnce(error);
    await expect(new IdbKeyValueStore().delete('index:Vault')).rejects.toBe(error);
  });
});
