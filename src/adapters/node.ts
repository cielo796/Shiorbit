/**
 * Node / Electron 用の VaultAdapter。
 *
 * ここも境界の外側。ただし fs を直接は触らず、FsBridge 越しに呼ぶ。
 * Electron ではレンダラから fs を触れないので、preload が公開した
 * IPC 経由の実装を差し込む前提（設計書 §4）。
 * テストでは node:fs/promises を差し込んで、本物のファイルシステムで検証する。
 */
import type { VaultAdapter } from '../core/vault/VaultAdapter';
import type { Entry, FileEvent, Stat, VaultCapabilities, Unsubscribe, VPath } from '../core/vault/types';
import { VaultError, enoent, eperm } from '../core/vault/errors';
import { basename, dirname, normalize, segments } from '../core/vault/path';

export interface DirEntry {
  name: string;
  isDirectory: boolean;
}

export interface FsStat {
  mtimeMs: number;
  size: number;
  isDirectory: boolean;
}

/** fs.promises の必要な部分だけを写した最小インターフェース */
export interface FsBridge {
  readonly sep: string;
  readText: (absPath: string) => Promise<string>;
  readBytes: (absPath: string) => Promise<Uint8Array>;
  writeText: (absPath: string, text: string) => Promise<void>;
  writeBytes: (absPath: string, data: Uint8Array) => Promise<void>;
  readDir: (absPath: string) => Promise<DirEntry[]>;
  stat: (absPath: string) => Promise<FsStat>;
  mkdirp: (absPath: string) => Promise<void>;
  /** 再帰削除。存在しなければ何もしない。 */
  remove: (absPath: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  /** 実装があれば外部変更を push で受け取れる */
  watch?: (absPath: string, cb: (relPath: string) => void) => Unsubscribe;
}

const CODES: Record<string, 'ENOENT' | 'EEXIST' | 'EPERM' | 'EISDIR' | 'ENOTDIR'> = {
  ENOENT: 'ENOENT',
  EEXIST: 'EEXIST',
  EACCES: 'EPERM',
  EPERM: 'EPERM',
  EISDIR: 'EISDIR',
  ENOTDIR: 'ENOTDIR',
};

function mapError(e: unknown, path: VPath): never {
  if (e instanceof VaultError) throw e;
  const code = (e as { code?: string } | null)?.code;
  const mapped = code ? CODES[code] : undefined;
  if (mapped === 'ENOENT') throw enoent(path);
  if (mapped === 'EPERM') throw eperm(`アクセスできません: ${path || '(ルート)'}`, e);
  if (mapped) throw new VaultError(mapped, `${mapped}: ${path}`, e);
  throw new VaultError('EIO', `入出力エラー: ${path || '(ルート)'}`, e);
}

class NodeAdapter implements VaultAdapter {
  readonly id = 'node';
  readonly caps: VaultCapabilities;

  constructor(
    private readonly fs: FsBridge,
    private readonly root: string,
    readonly name: string,
  ) {
    this.caps = {
      realFolder: true,
      watch: typeof fs.watch === 'function',
      rename: true,
      binary: true,
    };
  }

  /** Vault 相対パス → OS の絶対パス */
  private abs(path: VPath): string {
    const segs = segments(path);
    return segs.length === 0 ? this.root : this.root + this.fs.sep + segs.join(this.fs.sep);
  }

  async list(dir: VPath, recursive: boolean, withStat = false): Promise<Entry[]> {
    const out: Entry[] = [];

    const walk = async (prefix: VPath): Promise<void> => {
      let entries: DirEntry[];
      try {
        entries = await this.fs.readDir(this.abs(prefix));
      } catch (e) {
        if ((e as { code?: string } | null)?.code === 'ENOENT' && prefix !== normalize(dir)) return;
        mapError(e, prefix);
      }

      for (const entry of entries) {
        const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
        if (entry.isDirectory) {
          out.push({ path, name: entry.name, kind: 'dir' });
          if (recursive) await walk(path);
          continue;
        }
        if (!withStat) {
          out.push({ path, name: entry.name, kind: 'file' });
          continue;
        }
        try {
          const st = await this.fs.stat(this.abs(path));
          out.push({ path, name: entry.name, kind: 'file', mtime: st.mtimeMs, size: st.size });
        } catch {
          out.push({ path, name: entry.name, kind: 'file' });
        }
      }
    };

    await walk(normalize(dir));
    return out;
  }

  async read(path: VPath): Promise<string> {
    try {
      return await this.fs.readText(this.abs(path));
    } catch (e) {
      mapError(e, path);
    }
  }

  async readBinary(path: VPath): Promise<ArrayBuffer> {
    try {
      const bytes = await this.fs.readBytes(this.abs(path));
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return copy.buffer;
    } catch (e) {
      mapError(e, path);
    }
  }

  async write(path: VPath, text: string): Promise<void> {
    try {
      await this.ensureParent(path);
      await this.fs.writeText(this.abs(path), text);
    } catch (e) {
      mapError(e, path);
    }
  }

  async writeBinary(path: VPath, data: ArrayBuffer): Promise<void> {
    try {
      await this.ensureParent(path);
      await this.fs.writeBytes(this.abs(path), new Uint8Array(data));
    } catch (e) {
      mapError(e, path);
    }
  }

  async rename(from: VPath, to: VPath): Promise<void> {
    try {
      await this.ensureParent(to);
      await this.fs.rename(this.abs(from), this.abs(to));
    } catch (e) {
      mapError(e, from);
    }
  }

  async remove(path: VPath): Promise<void> {
    try {
      await this.fs.remove(this.abs(path));
    } catch (e) {
      mapError(e, path);
    }
  }

  async mkdir(path: VPath): Promise<void> {
    try {
      await this.fs.mkdirp(this.abs(path));
    } catch (e) {
      mapError(e, path);
    }
  }

  async stat(path: VPath): Promise<Stat> {
    try {
      const st = await this.fs.stat(this.abs(path));
      return { mtime: st.mtimeMs, size: st.size };
    } catch (e) {
      mapError(e, path);
    }
  }

  async exists(path: VPath): Promise<boolean> {
    try {
      await this.fs.stat(this.abs(path));
      return true;
    } catch {
      return false;
    }
  }

  watch(onEvent: (ev: FileEvent) => void): Unsubscribe {
    if (!this.fs.watch) return () => undefined;
    return this.fs.watch(this.root, (relPath) => {
      const path = normalize(relPath.split(this.fs.sep).join('/'));
      if (path === '') return;
      onEvent({ type: 'modify', path });
    });
  }

  private async ensureParent(path: VPath): Promise<void> {
    const parent = dirname(path);
    if (parent !== '') await this.fs.mkdirp(this.abs(parent));
  }
}

export function createNodeAdapter(fs: FsBridge, root: string, name?: string): VaultAdapter {
  const label = name ?? basename(root.split(/[\\/]/).join('/')) ?? 'Vault';
  return new NodeAdapter(fs, root, label === '' ? 'Vault' : label);
}
