import type { KeyValueStore } from '../core/storage/KeyValueStore';
import type { CapFilesystem } from './capacitor';

/**
 * モバイル向けの KeyValueStore。
 *
 * インデックスのキャッシュは数 MB になりうるので、
 * Preferences（UserDefaults / SharedPreferences）ではなくファイルとして保存する。
 * 置き場所はアプリ専用領域（Directory.Data）。ユーザーには見えないし、
 * 消えても全件スキャンし直せばよいだけ。
 */
export function createCapacitorKvStore(
  fs: CapFilesystem,
  directory = 'DATA',
  folder = 'shiorbit-cache',
): KeyValueStore {
  const pathOf = (key: string): string => `${folder}/${encodeURIComponent(key)}.json`;

  return {
    async get<T>(key: string): Promise<T | null> {
      try {
        const res = await fs.readFile({ path: pathOf(key), directory, encoding: 'utf8' });
        const text = typeof res.data === 'string' ? res.data : await res.data.text();
        return JSON.parse(text) as T;
      } catch {
        return null;
      }
    },

    async set(key: string, value: unknown): Promise<void> {
      try {
        await fs.writeFile({
          path: pathOf(key),
          directory,
          data: JSON.stringify(value),
          encoding: 'utf8',
          recursive: true,
        });
      } catch (e) {
        console.warn('[capacitorKv] 保存に失敗しました (キャッシュなしで続行します)', e);
      }
    },

    async delete(key: string): Promise<void> {
      try {
        await fs.deleteFile({ path: pathOf(key), directory });
      } catch {
        /* 消せなくても困らない */
      }
    },
  };
}
