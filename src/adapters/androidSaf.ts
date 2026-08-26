import { registerPlugin } from '@capacitor/core';
import type { VaultAdapter } from '../core/vault/VaultAdapter';
import type { CapFilesystem } from './capacitor';
import { createCapacitorAdapter } from './capacitor';

export interface SafSelection {
  selected: boolean;
  uri?: string;
  name?: string;
}

/** Android ネイティブ側の Storage Access Framework プラグイン。 */
export interface AndroidSafPlugin extends CapFilesystem {
  pickTree: () => Promise<SafSelection>;
  getSavedTree: () => Promise<SafSelection>;
  forgetTree: () => Promise<void>;
}

export interface AndroidSafVault {
  adapter: VaultAdapter;
  uri: string;
}

const SafVault = registerPlugin<AndroidSafPlugin>('SafVault');

function createVault(plugin: AndroidSafPlugin, selection: SafSelection): AndroidSafVault {
  if (!selection.selected || !selection.uri) {
    throw new Error('SAF フォルダが選択されていません');
  }

  return {
    adapter: createCapacitorAdapter(plugin, {
      // SAF プラグインは URI を内部に保持するため、directory と subdir は使わない。
      subdir: '',
      name: selection.name?.trim() || 'Android Vault',
    }),
    uri: selection.uri,
  };
}

function asAbortError(error: unknown): unknown {
  if ((error as { code?: string } | null)?.code !== 'PICK_CANCELLED') return error;
  return Object.assign(new Error('フォルダ選択が取り消されました'), { name: 'AbortError' });
}

/** Android 標準のフォルダ選択画面を開き、選択した Vault を返す。 */
export async function pickAndroidSafVault(plugin: AndroidSafPlugin = SafVault): Promise<AndroidSafVault> {
  try {
    return createVault(plugin, await plugin.pickTree());
  } catch (error) {
    throw asAbortError(error);
  }
}

/** 前回選択したフォルダへの永続アクセス権を復元する。 */
export async function restoreAndroidSafVault(
  plugin: AndroidSafPlugin = SafVault,
): Promise<AndroidSafVault | null> {
  const selection = await plugin.getSavedTree();
  return selection.selected ? createVault(plugin, selection) : null;
}

export async function hasAndroidSafVault(plugin: AndroidSafPlugin = SafVault): Promise<boolean> {
  try {
    return (await plugin.getSavedTree()).selected;
  } catch {
    return false;
  }
}

/** URI 権限の記憶だけを解除する。Vault 内の実ファイルは削除しない。 */
export async function forgetAndroidSafVault(plugin: AndroidSafPlugin = SafVault): Promise<void> {
  await plugin.forgetTree();
}
