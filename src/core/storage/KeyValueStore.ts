/**
 * 小さな Key-Value 保存領域。これも「境界」のひとつ (設計書 §13)。
 *
 * インデックスのキャッシュはノートそのものではないので Vault には置かない。
 * 置き場所はプラットフォームによって違う
 * (ブラウザなら IndexedDB、モバイルアプリなら Preferences、Node ならファイル) ため、
 * ここでも実装を差し替えられるようにしておく。
 *
 * core / ui は indexedDB という単語を知らない。実装は src/adapters/ にある。
 */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

/** 保存先が無い環境向けの何もしない実装 */
export const nullStore: KeyValueStore = {
  get: async () => null,
  set: async () => undefined,
  delete: async () => undefined,
};
