import type { VaultAdapter } from '../core/vault/VaultAdapter';
import type { KeyValueStore } from '../core/storage/KeyValueStore';
import { createCapacitorAdapter, type CapFilesystem } from './capacitor';
import { createCapacitorKvStore } from './capacitorKv';

export interface NativeVault {
  adapter: VaultAdapter;
  cache: KeyValueStore;
}

/** インデックス用キャッシュだけをアプリ専用領域で開く。 */
export async function openNativeCache(): Promise<KeyValueStore | null> {
  try {
    const mod = (await import('@capacitor/filesystem')) as unknown as {
      Filesystem: CapFilesystem;
    };
    return createCapacitorKvStore(mod.Filesystem);
  } catch (e) {
    console.warn('[nativeVault] Capacitor のキャッシュ領域を開けませんでした', e);
    return null;
  }
}

/**
 * Vault フォルダ名はアプリ名に揃える。
 *
 * 一時期 'Obdisan'（'Obidisan' から i が1つ欠けた綴り）を既定にしていたので、
 * それも移行元に入れてある。移行は「見つけた最初の1つを改名する」だけなので、
 * どの状態から起動してもノートを見失わない。
 */
const DEFAULT_VAULT_DIR = 'Shiorbit';
const MISSPELLED_VAULT_DIR = 'Obdisan';
const LEGACY_VAULT_DIR = 'Obidisan';

const MIGRATION_SOURCES = [MISSPELLED_VAULT_DIR, LEGACY_VAULT_DIR] as const;

async function directoryExists(fs: CapFilesystem, path: string): Promise<boolean> {
  return fs
    .stat({ path, directory: 'DOCUMENTS' })
    .then(() => true)
    .catch(() => false);
}

/**
 * 既存のモバイル Vault を、現在の既定フォルダへ安全に移行する。
 * 移行に失敗した場合はデータを見失わないよう、元のフォルダをそのまま開く。
 */
export async function resolveNativeVaultDir(fs: CapFilesystem, subdir: string): Promise<string> {
  if (subdir !== DEFAULT_VAULT_DIR || (await directoryExists(fs, DEFAULT_VAULT_DIR))) {
    return subdir;
  }

  for (const source of MIGRATION_SOURCES) {
    if (!(await directoryExists(fs, source))) continue;

    try {
      await fs.rename({
        from: source,
        to: DEFAULT_VAULT_DIR,
        directory: 'DOCUMENTS',
        toDirectory: 'DOCUMENTS',
      });
      return DEFAULT_VAULT_DIR;
    } catch (e) {
      console.warn(`[nativeVault] ${source} Vault を ${DEFAULT_VAULT_DIR} に改名できなかったため、そのまま開きます`, e);
      return source;
    }
  }

  return DEFAULT_VAULT_DIR;
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
export async function openNativeVault(subdir = DEFAULT_VAULT_DIR): Promise<NativeVault | null> {
  try {
    const mod = (await import('@capacitor/filesystem')) as unknown as {
      Filesystem: CapFilesystem;
    };
    const fs = mod.Filesystem;

    const actualSubdir = await resolveNativeVaultDir(fs, subdir);

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
