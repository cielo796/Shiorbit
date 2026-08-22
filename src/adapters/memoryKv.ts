import type { KeyValueStore } from '../core/storage/KeyValueStore';

/** テスト用。構造化複製を模して、出し入れのたびに値をコピーする。 */
export class MemoryKeyValueStore implements KeyValueStore {
  private readonly map = new Map<string, string>();

  async get<T>(key: string): Promise<T | null> {
    const raw = this.map.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as T);
  }

  async set(key: string, value: unknown): Promise<void> {
    this.map.set(key, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }
}
