/**
 * iOS / Android 用の VaultAdapter（@capacitor/filesystem 越し）。
 *
 * ここも境界の外側。プラグインは直接 import せず、
 * 差し替え可能な最小インターフェース CapFilesystem 越しに呼ぶ。
 * こうしておくと実機がなくてもテストできる。
 */
import type { VaultAdapter } from '../core/vault/VaultAdapter';
import type { Entry, Stat, VaultCapabilities, VPath } from '../core/vault/types';
import { VaultError, enoent, eperm } from '../core/vault/errors';
import { dirname, normalize, segments } from '../core/vault/path';

export interface CapFileInfo {
  name: string;
  type: 'file' | 'directory';
  size: number;
  /** epoch ミリ秒 */
  mtime: number;
}

/** @capacitor/filesystem のうち、このアダプタが使う部分だけ */
export interface CapFilesystem {
  readFile: (o: { path: string; directory?: string; encoding?: string }) => Promise<{ data: string | Blob }>;
  writeFile: (o: {
    path: string;
    directory?: string;
    data: string;
    encoding?: string;
    recursive?: boolean;
  }) => Promise<unknown>;
  readdir: (o: { path: string; directory?: string }) => Promise<{ files: CapFileInfo[] }>;
  mkdir: (o: { path: string; directory?: string; recursive?: boolean }) => Promise<unknown>;
  rmdir: (o: { path: string; directory?: string; recursive?: boolean }) => Promise<unknown>;
  deleteFile: (o: { path: string; directory?: string }) => Promise<unknown>;
  rename: (o: { from: string; to: string; directory?: string; toDirectory?: string }) => Promise<unknown>;
  stat: (o: { path: string; directory?: string }) => Promise<{ type: string; size: number; mtime: number }>;
}

export interface CapacitorAdapterOptions {
  /** Capacitor の Directory 値。既定は DOCUMENTS（iOS の Files アプリに出る場所） */
  directory?: string;
  /** Vault にするサブフォルダ。'' ならディレクトリ直下。 */
  subdir?: string;
  name?: string;
}

const UTF8 = 'utf8';

/** Capacitor のエラーは文字列なので、内容から種別を推測して VaultError に翻訳する */
function mapError(e: unknown, path: VPath): never {
  if (e instanceof VaultError) throw e;
  const message = String((e as { message?: string } | null)?.message ?? e ?? '');
  if (/not exist|no such|ENOENT|NOT_FOUND|does not exist/i.test(message)) throw enoent(path);
  if (/permission|denied|EACCES|EPERM/i.test(message)) {
    throw eperm(`アクセスできません: ${path || '(ルート)'}`, e);
  }
  if (/exists/i.test(message)) throw new VaultError('EEXIST', `すでに存在します: ${path}`, e);
  throw new VaultError('EIO', `入出力エラー: ${path || '(ルート)'}`, e);
}

class CapacitorAdapter implements VaultAdapter {
  readonly id = 'capacitor';
  readonly caps: VaultCapabilities = {
    realFolder: true,
    // Capacitor には push のファイル監視が無いので VaultService 側でポーリングする
    watch: false,
    rename: true,
    binary: true,
  };

  private readonly directory: string;
  private readonly subdir: string;

  constructor(
    private readonly fs: CapFilesystem,
    options: CapacitorAdapterOptions,
    readonly name: string,
  ) {
    this.directory = options.directory ?? 'DOCUMENTS';
    this.subdir = normalize(options.subdir ?? '');
  }

  /** Vault 相対パス → プラグインに渡すパス */
  private p(path: VPath): string {
    const segs = segments(path);
    const base = this.subdir === '' ? [] : this.subdir.split('/');
    return [...base, ...segs].join('/');
  }

  async list(dir: VPath, recursive: boolean, withStat = false): Promise<Entry[]> {
    const out: Entry[] = [];

    const walk = async (prefix: VPath): Promise<void> => {
      let files: CapFileInfo[];
      try {
        files = (await this.fs.readdir({ path: this.p(prefix), directory: this.directory })).files;
      } catch (e) {
        if (prefix !== normalize(dir)) return; // 途中の欠損は無視
        mapError(e, prefix);
      }

      for (const info of files) {
        const path = prefix === '' ? info.name : `${prefix}/${info.name}`;
        if (info.type === 'directory') {
          out.push({ path, name: info.name, kind: 'dir' });
          if (recursive) await walk(path);
        } else if (withStat) {
          out.push({ path, name: info.name, kind: 'file', mtime: info.mtime, size: info.size });
        } else {
          out.push({ path, name: info.name, kind: 'file' });
        }
      }
    };

    await walk(normalize(dir));
    return out;
  }

  async read(path: VPath): Promise<string> {
    try {
      const res = await this.fs.readFile({
        path: this.p(path),
        directory: this.directory,
        encoding: UTF8,
      });
      return typeof res.data === 'string' ? res.data : await res.data.text();
    } catch (e) {
      mapError(e, path);
    }
  }

  async readBinary(path: VPath): Promise<ArrayBuffer> {
    try {
      // encoding を渡さないと base64 で返る
      const res = await this.fs.readFile({ path: this.p(path), directory: this.directory });
      if (typeof res.data !== 'string') return await res.data.arrayBuffer();
      return base64ToBytes(res.data).buffer as ArrayBuffer;
    } catch (e) {
      mapError(e, path);
    }
  }

  async write(path: VPath, text: string): Promise<void> {
    try {
      await this.fs.writeFile({
        path: this.p(path),
        directory: this.directory,
        data: text,
        encoding: UTF8,
        recursive: true,
      });
    } catch (e) {
      mapError(e, path);
    }
  }

  async writeBinary(path: VPath, data: ArrayBuffer): Promise<void> {
    try {
      await this.fs.writeFile({
        path: this.p(path),
        directory: this.directory,
        data: bytesToBase64(new Uint8Array(data)),
        recursive: true,
      });
    } catch (e) {
      mapError(e, path);
    }
  }

  async rename(from: VPath, to: VPath): Promise<void> {
    try {
      const parent = dirname(to);
      if (parent !== '') await this.mkdir(parent);
      await this.fs.rename({
        from: this.p(from),
        to: this.p(to),
        directory: this.directory,
        toDirectory: this.directory,
      });
    } catch (e) {
      mapError(e, from);
    }
  }

  async remove(path: VPath): Promise<void> {
    try {
      const info = await this.fs.stat({ path: this.p(path), directory: this.directory });
      if (info.type === 'directory') {
        await this.fs.rmdir({ path: this.p(path), directory: this.directory, recursive: true });
      } else {
        await this.fs.deleteFile({ path: this.p(path), directory: this.directory });
      }
    } catch (e) {
      mapError(e, path);
    }
  }

  async mkdir(path: VPath): Promise<void> {
    if (normalize(path) === '') return;
    try {
      await this.fs.mkdir({ path: this.p(path), directory: this.directory, recursive: true });
    } catch (e) {
      // 既に存在する場合は成功扱い（mkdir -p と同じ振る舞いに揃える）
      const message = String((e as { message?: string } | null)?.message ?? '');
      if (/exist/i.test(message)) return;
      mapError(e, path);
    }
  }

  async stat(path: VPath): Promise<Stat> {
    try {
      const info = await this.fs.stat({ path: this.p(path), directory: this.directory });
      return { mtime: info.mtime, size: info.size };
    } catch (e) {
      mapError(e, path);
    }
  }

  async exists(path: VPath): Promise<boolean> {
    try {
      await this.fs.stat({ path: this.p(path), directory: this.directory });
      return true;
    } catch {
      return false;
    }
  }
}

export function createCapacitorAdapter(
  fs: CapFilesystem,
  options: CapacitorAdapterOptions = {},
): VaultAdapter {
  const label = options.name ?? (options.subdir && options.subdir !== '' ? options.subdir : 'Vault');
  return new CapacitorAdapter(fs, options, label);
}

// ---------------------------------------------------------------- base64

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
