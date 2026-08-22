/**
 * 本物のファイルシステムに繋がる FsBridge。
 *
 * ブラウザ向けのバンドルには絶対に入らないよう、main.ts からは import しない。
 * 使うのは Electron のメインプロセスと、テストだけ。
 */
import type { DirEntry, FsBridge, FsStat } from './node';

export async function createNodeFsBridge(): Promise<FsBridge> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  return {
    sep: path.sep,

    async readText(absPath: string): Promise<string> {
      return fs.readFile(absPath, 'utf8');
    },

    async readBytes(absPath: string): Promise<Uint8Array> {
      const buf = await fs.readFile(absPath);
      return new Uint8Array(buf);
    },

    async writeText(absPath: string, text: string): Promise<void> {
      await fs.writeFile(absPath, text, 'utf8');
    },

    async writeBytes(absPath: string, data: Uint8Array): Promise<void> {
      await fs.writeFile(absPath, data);
    },

    async readDir(absPath: string): Promise<DirEntry[]> {
      const entries = await fs.readdir(absPath, { withFileTypes: true });
      return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
    },

    async stat(absPath: string): Promise<FsStat> {
      const st = await fs.stat(absPath);
      return { mtimeMs: st.mtimeMs, size: st.size, isDirectory: st.isDirectory() };
    },

    async mkdirp(absPath: string): Promise<void> {
      await fs.mkdir(absPath, { recursive: true });
    },

    async remove(absPath: string): Promise<void> {
      await fs.rm(absPath, { recursive: true, force: true });
    },

    async rename(from: string, to: string): Promise<void> {
      await fs.rename(from, to);
    },
  };
}
