/**
 * Electron（デスクトップアプリ）用のアダプタ組み立て。
 *
 * preload が公開した IPC を FsBridge の形にして node.ts に渡すだけ。
 * ファイルの読み書きそのものはメインプロセスで行われる（設計書 §4）。
 */
import type { VaultAdapter } from '../core/vault/VaultAdapter';
import type { Entry } from '../core/vault/types';
import type { KeyValueStore } from '../core/storage/KeyValueStore';
import type { DirEntry, FsBridge, FsStat } from './node';
import { createNodeAdapter } from './node';
import { createKeyValueStore } from './idbKv';

interface NativeFs {
  readText: (p: string) => Promise<string>;
  readBytes: (p: string) => Promise<Uint8Array>;
  writeText: (p: string, text: string) => Promise<void>;
  writeBytes: (p: string, data: Uint8Array) => Promise<void>;
  readDir: (p: string, withStat?: boolean) => Promise<DirEntry[]>;
  listTree?: (p: string, withStat?: boolean) => Promise<Entry[]>;
  stat: (p: string) => Promise<FsStat>;
  mkdirp: (p: string) => Promise<void>;
  remove: (p: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
}

interface NativeBridge {
  init: () => Promise<{ sep: string; vaultPath: string | null; version: string }>;
  pickVault: () => Promise<string | null>;
  forgetVault: () => Promise<void>;
  fs: NativeFs;
}

function bridge(): NativeBridge | null {
  const g = (globalThis as Record<string, unknown>)['shiorbitNative'];
  return typeof g === 'object' && g !== null ? (g as NativeBridge) : null;
}

export function isElectron(): boolean {
  return bridge() !== null;
}

function toFsBridge(native: NativeBridge, sep: string): FsBridge {
  return { sep, ...native.fs };
}

export interface ElectronVault {
  adapter: VaultAdapter;
  cache: KeyValueStore | null;
  path: string;
}

/** 前回開いた Vault を復元する。無ければ null。 */
export async function restoreElectronVault(): Promise<ElectronVault | null> {
  const native = bridge();
  if (!native) return null;

  const info = await native.init();
  if (!info.vaultPath) return null;

  return {
    adapter: createNodeAdapter(toFsBridge(native, info.sep), info.vaultPath),
    cache: createKeyValueStore(),
    path: info.vaultPath,
  };
}

/** フォルダ選択ダイアログを出して Vault を開く。 */
export async function pickElectronVault(): Promise<ElectronVault | null> {
  const native = bridge();
  if (!native) return null;

  const picked = await native.pickVault();
  if (!picked) return null;

  const info = await native.init();
  return {
    adapter: createNodeAdapter(toFsBridge(native, info.sep), picked),
    cache: createKeyValueStore(),
    path: picked,
  };
}

/** 次回起動用に記憶した Vault のパスだけを消去する。 */
export async function forgetElectronVault(): Promise<void> {
  const native = bridge();
  if (!native) return;
  await native.forgetVault();
}
