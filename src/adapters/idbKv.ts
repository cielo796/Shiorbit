import type { KeyValueStore } from '../core/storage/KeyValueStore';
import { STORE_KV, idbDelete, idbGet, idbPut } from './idb';

/**
 * ブラウザ向けの KeyValueStore 実装 (IndexedDB)。
 *
 * インデックスのキャッシュ置き場。失われても全件スキャンし直せばよいだけなので、
 * 読込み失敗はキャッシュなしとして扱う。書込み・削除の失敗は呼出し元へ
 * 伝え、索引側で再試行できるようにする（ノート本体には影響しない）。
 */
export class IdbKeyValueStore implements KeyValueStore {
  async get<T>(key: string): Promise<T | null> {
    try {
      return (await idbGet<T>(STORE_KV, key)) ?? null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    try {
      await idbPut(STORE_KV, key, value);
    } catch (e) {
      console.warn('[IdbKeyValueStore] 保存に失敗しました (キャッシュなしで続行します)', e);
      // Indexerが旧索引を消す前に、保存成功を判断できるよう失敗を伝える。
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await idbDelete(STORE_KV, key);
  }
}

export function createKeyValueStore(): KeyValueStore | null {
  return typeof indexedDB === 'undefined' ? null : new IdbKeyValueStore();
}
