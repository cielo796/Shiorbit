/**
 * File System Access API アダプタ (PC の Chrome / Edge / Opera 専用)。
 *
 * このファイルは境界の「外側」。プラットフォーム固有のコードはここに閉じ込める。
 * showDirectoryPicker などの識別子が src/adapters/ の外に出たら設計違反 (設計書 §13.4 ルール1)。
 * scripts/check-boundary.mjs が自動で検出する。
 */
import type { VaultAdapter } from '../core/vault/VaultAdapter';
import type { Entry, Stat, VaultCapabilities, VPath } from '../core/vault/types';
import { VaultError, enoent, eperm } from '../core/vault/errors';
import { basename, dirname, normalize, segments } from '../core/vault/path';
import { STORE_HANDLES, idbDelete, idbGet, idbPut } from './idb';

// ---------------------------------------------------------------------------
// 最小限の型定義。lib.dom との衝突を避けるため独自の名前を使う。
// ---------------------------------------------------------------------------

interface FsaPerm {
  mode: 'read' | 'readwrite';
}

interface FsaBase {
  readonly kind: 'file' | 'directory';
  readonly name: string;
  queryPermission?(desc: FsaPerm): Promise<PermissionState>;
  requestPermission?(desc: FsaPerm): Promise<PermissionState>;
}

interface FsaWritable {
  write(data: string | ArrayBuffer | ArrayBufferView | Blob): Promise<void>;
  close(): Promise<void>;
}

interface FsaFile extends FsaBase {
  readonly kind: 'file';
  getFile(): Promise<File>;
  createWritable(opts?: { keepExistingData?: boolean }): Promise<FsaWritable>;
  move?(parent: FsaDir, name: string): Promise<void>;
}

interface FsaDir extends FsaBase {
  readonly kind: 'directory';
  entries(): AsyncIterableIterator<[string, FsaFile | FsaDir]>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FsaFile>;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FsaDir>;
  removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>;
}

type PickerFn = (opts?: {
  mode?: 'read' | 'readwrite';
  id?: string;
  startIn?: string;
}) => Promise<FsaDir>;

function getPicker(): PickerFn | null {
  const fn = (globalThis as Record<string, unknown>)['showDirectoryPicker'];
  return typeof fn === 'function' ? (fn as PickerFn) : null;
}

export function isFsaSupported(): boolean {
  return getPicker() !== null;
}

// ---------------------------------------------------------------------------
// ハンドルの永続化
//
// FileSystemDirectoryHandle は構造化複製できるので IndexedDB に保存できる。
// ただし権限は起動ごとに失効するため、復元にはユーザー操作起点の再許可が要る。
// ---------------------------------------------------------------------------

const ROOT_KEY = 'vault-root';

async function saveHandle(handle: FsaDir): Promise<void> {
  await idbPut(STORE_HANDLES, ROOT_KEY, handle);
}

async function loadHandle(): Promise<FsaDir | null> {
  try {
    return (await idbGet<FsaDir>(STORE_HANDLES, ROOT_KEY)) ?? null;
  } catch {
    return null;
  }
}

export async function forgetVault(): Promise<void> {
  try {
    await idbDelete(STORE_HANDLES, ROOT_KEY);
  } catch {
    /* 保存されていなければ何もしない */
  }
}

// ---------------------------------------------------------------------------
// エラー変換: ブラウザ固有の例外を VaultError に翻訳して境界の外へ出す
// ---------------------------------------------------------------------------

function mapError(e: unknown, path: VPath): never {
  if (e instanceof VaultError) throw e;
  const name = (e as { name?: string } | null)?.name;
  if (name === 'NotFoundError') throw enoent(path);
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    throw eperm(`フォルダへのアクセス権がありません: ${path || '(ルート)'}`, e);
  }
  throw new VaultError('EIO', `入出力エラー: ${path || '(ルート)'}`, e);
}

// ---------------------------------------------------------------------------
// アダプタ本体
// ---------------------------------------------------------------------------

class FsaAdapter implements VaultAdapter {
  readonly id = 'fsa';
  readonly caps: VaultCapabilities = {
    realFolder: true,
    watch: false, // push 通知がないので VaultService 側でポーリングする
    rename: true,
    binary: true,
  };

  constructor(private readonly root: FsaDir) {}

  get name(): string {
    return this.root.name;
  }

  private async resolveDir(path: VPath, create: boolean): Promise<FsaDir> {
    let dir = this.root;
    for (const seg of segments(path)) {
      dir = await dir.getDirectoryHandle(seg, { create });
    }
    return dir;
  }

  private async resolveFile(path: VPath, create: boolean): Promise<FsaFile> {
    const dir = await this.resolveDir(dirname(path), create);
    return dir.getFileHandle(basename(path), { create });
  }

  async list(dir: VPath, recursive: boolean, withStat = false): Promise<Entry[]> {
    const out: Entry[] = [];
    const walk = async (handle: FsaDir, prefix: VPath): Promise<void> => {
      for await (const [name, child] of handle.entries()) {
        const path = prefix === '' ? name : `${prefix}/${name}`;
        if (child.kind === 'directory') {
          out.push({ path, name, kind: 'dir' });
          if (recursive) await walk(child, path);
        } else if (withStat) {
          // 走査中のハンドルをそのまま使う。あとで stat し直すより1往復少ない。
          try {
            const file = await child.getFile();
            out.push({ path, name, kind: 'file', mtime: file.lastModified, size: file.size });
          } catch {
            out.push({ path, name, kind: 'file' });
          }
        } else {
          out.push({ path, name, kind: 'file' });
        }
      }
    };
    try {
      await walk(await this.resolveDir(dir, false), normalize(dir));
    } catch (e) {
      mapError(e, dir);
    }
    return out;
  }

  async read(path: VPath): Promise<string> {
    try {
      const file = await (await this.resolveFile(path, false)).getFile();
      return await file.text();
    } catch (e) {
      mapError(e, path);
    }
  }

  async readBinary(path: VPath): Promise<ArrayBuffer> {
    try {
      const file = await (await this.resolveFile(path, false)).getFile();
      return await file.arrayBuffer();
    } catch (e) {
      mapError(e, path);
    }
  }

  async write(path: VPath, text: string): Promise<void> {
    await this.writeAny(path, text);
  }

  async writeBinary(path: VPath, data: ArrayBuffer): Promise<void> {
    await this.writeAny(path, data);
  }

  private async writeAny(path: VPath, data: string | ArrayBuffer): Promise<void> {
    let writable: FsaWritable | null = null;
    try {
      const handle = await this.resolveFile(path, true);
      writable = await handle.createWritable();
      await writable.write(data);
    } catch (e) {
      mapError(e, path);
    } finally {
      // close() を忘れると書き込みが破棄される。必ず閉じる (設計書 §4)
      if (writable) await writable.close().catch(() => undefined);
    }
  }

  async rename(from: VPath, to: VPath): Promise<void> {
    try {
      const src = await this.resolveFile(from, false);
      if (typeof src.move === 'function') {
        const destDir = await this.resolveDir(dirname(to), true);
        await src.move(destDir, basename(to));
        return;
      }
      // move() 非対応環境向けフォールバック: コピーしてから削除
      const buf = await (await src.getFile()).arrayBuffer();
      await this.writeBinary(to, buf);
      await this.remove(from);
    } catch (e) {
      mapError(e, from);
    }
  }

  async remove(path: VPath): Promise<void> {
    try {
      const parent = await this.resolveDir(dirname(path), false);
      await parent.removeEntry(basename(path), { recursive: true });
    } catch (e) {
      mapError(e, path);
    }
  }

  async mkdir(path: VPath): Promise<void> {
    try {
      await this.resolveDir(path, true);
    } catch (e) {
      mapError(e, path);
    }
  }

  async stat(path: VPath): Promise<Stat> {
    try {
      const file = await (await this.resolveFile(path, false)).getFile();
      return { mtime: file.lastModified, size: file.size };
    } catch (e) {
      const name = (e as { name?: string } | null)?.name;
      if (name === 'TypeMismatchError') return { mtime: 0, size: 0 }; // ディレクトリ
      mapError(e, path);
    }
  }

  async exists(path: VPath): Promise<boolean> {
    try {
      await this.resolveFile(path, false);
      return true;
    } catch {
      try {
        await this.resolveDir(path, false);
        return true;
      } catch {
        return false;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 公開 API — アプリはここだけを呼ぶ
// ---------------------------------------------------------------------------

/** フォルダ選択ダイアログを出す。必ずユーザー操作 (クリック) から呼ぶこと。 */
export async function pickVault(): Promise<VaultAdapter> {
  const picker = getPicker();
  if (!picker) {
    throw eperm('このブラウザは File System Access API に対応していません。');
  }
  const handle = await picker({ mode: 'readwrite', id: 'shiorbit-vault' });
  await saveHandle(handle).catch(() => undefined);
  return new FsaAdapter(handle);
}

/**
 * 前回の Vault を復元する。
 *
 * prompt=false : すでに権限が残っている場合だけ復元する (起動直後の自動復元用)
 * prompt=true  : 権限ダイアログを出す (ユーザー操作から呼ぶこと)
 */
export async function restoreVault(opts: { prompt?: boolean } = {}): Promise<VaultAdapter | null> {
  if (!isFsaSupported()) return null;
  const handle = await loadHandle();
  if (!handle) return null;

  const desc: FsaPerm = { mode: 'readwrite' };
  let state: PermissionState = 'granted';
  if (handle.queryPermission) state = await handle.queryPermission(desc);
  if (state !== 'granted' && opts.prompt && handle.requestPermission) {
    state = await handle.requestPermission(desc);
  }
  if (state !== 'granted') return null;

  return new FsaAdapter(handle);
}

/** 保存済み Vault があるか (権限は問わない) */
export async function hasSavedVault(): Promise<boolean> {
  return (await loadHandle()) !== null;
}
