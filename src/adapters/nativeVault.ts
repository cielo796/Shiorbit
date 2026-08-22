import type { VaultAdapter } from '../core/vault/VaultAdapter';
import type { KeyValueStore } from '../core/storage/KeyValueStore';
import { createCapacitorAdapter, type CapFilesystem } from './capacitor';
import { createCapacitorKvStore } from './capacitorKv';

export interface NativeVault {
  adapter: VaultAdapter;
  cache: KeyValueStore;
}

/**
 * ネイティブアプリ（iOS / Android）の Vault を開く。
 *
 * Documents の下の固定フォルダを Vault にする。
 * iOS では Info.plist に UIFileSharingEnabled と LSSupportsOpeningDocumentsInPlace を
 * 入れておくことで、このフォルダが「ファイル」アプリに現れ、
 * iCloud Drive 経由で PC と同期できる（設計書 §4 / §9）。
 *
 * プラグインは動的 import する。ブラウザ向けのバンドルに Capacitor を混ぜないため。
 */
const DEFAULT_VAULT_DIR = 'Shiorbit';
const LEGACY_VAULT_DIR = 'Obidisan';

export async function openNativeVault(subdir = DEFAULT_VAULT_DIR): Promise<NativeVault | null> {
  try {
    const mod = (await import('@capacitor/filesystem')) as unknown as {
      Filesystem: CapFilesystem;
    };
    const fs = mod.Filesystem;

    let actualSubdir = subdir;
    if (subdir === DEFAULT_VAULT_DIR) {
      const currentExists = await fs
        .stat({ path: DEFAULT_VAULT_DIR, directory: 'DOCUMENTS' })
        .then(() => true)
        .catch(() => false);
      const legacyExists = await fs
        .stat({ path: LEGACY_VAULT_DIR, directory: 'DOCUMENTS' })
        .then(() => true)
        .catch(() => false);

      if (!currentExists && legacyExists) {
        try {
          await fs.rename({
            from: LEGACY_VAULT_DIR,
            to: DEFAULT_VAULT_DIR,
            directory: 'DOCUMENTS',
            toDirectory: 'DOCUMENTS',
          });
        } catch (e) {
          // 移行に失敗しても、旧 Vault を開いてユーザーデータを見失わない。
          console.warn('[nativeVault] 旧 Obidisan Vault を改名できなかったため、そのまま開きます', e);
          actualSubdir = LEGACY_VAULT_DIR;
        }
      }
    }

    // Vault フォルダが無ければ作る
    await fs.mkdir({ path: actualSubdir, directory: 'DOCUMENTS', recursive: true }).catch(() => undefined);

    return {
      adapter: createCapacitorAdapter(fs, {
        directory: 'DOCUMENTS',
        subdir: actualSubdir,
        name: actualSubdir,
      }),
      cache: createCapacitorKvStore(fs),
    };
  } catch (e) {
    console.warn('[nativeVault] Capacitor のファイルシステムを開けませんでした', e);
    return null;
  }
}
