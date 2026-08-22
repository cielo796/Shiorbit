import type { KeyValueStore } from '../core/storage/KeyValueStore';
import { STORE_KV, idbDelete, idbGet, idbPut } from './idb';

/**
 * ブラウザ向けの KeyValueStore 実装 (IndexedDB)。
 *
 * インデックスのキャッシュ置き場。失われても全件スキャンし直せばよいだけなので、
 * 例外はすべて握り潰して「保存できなかった」で済ませる。
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
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await idbDelete(STORE_KV, key);
    } catch {
      /* 消せなくても困らない */
    }
  }
}

export function createKeyValueStore(): KeyValueStore | null {
  return typeof indexedDB === 'undefined' ? null : new IdbKeyValueStore();
}
