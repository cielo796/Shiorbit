import type { CapFileInfo, CapFilesystem } from '../src/adapters/capacitor';
import { base64ToBytes, bytesToBase64 } from '../src/adapters/capacitor';

interface Node {
  type: 'file' | 'directory';
  data?: Uint8Array;
  mtime: number;
}

/**
 * @capacitor/filesystem の振る舞いを真似た偽プラグイン。
 *
 * 実機がなくてもアダプタを契約テストにかけられるようにするためのもの。
 * エラーメッセージも本物に寄せてあり、アダプタ側のエラー判定が効いているか確認できる。
 */
export function createFakeCapacitorFs(): CapFilesystem & { dump: () => string[] } {
  const nodes = new Map<string, Node>();
  let clock = 1_700_000_000_000;
  const now = (): number => (clock += 1000);

  const norm = (p: string): string => p.replace(/^\/+|\/+$/g, '');
  const parentOf = (p: string): string => norm(p).split('/').slice(0, -1).join('/');
  const nameOf = (p: string): string => norm(p).split('/').pop() ?? '';

  const notFound = (p: string): Error => new Error(`File does not exist: ${p}`);

  const ensureDirs = (p: string): void => {
    const segs = norm(p).split('/').filter(Boolean);
    for (let i = 1; i <= segs.length; i++) {
      const dir = segs.slice(0, i).join('/');
      if (!nodes.has(dir)) nodes.set(dir, { type: 'directory', mtime: now() });
    }
  };

  return {
    dump: () => [...nodes.keys()].sort(),

    async readFile({ path, encoding }) {
      const node = nodes.get(norm(path));
      if (!node || node.type !== 'file') throw notFound(path);
      const bytes = node.data ?? new Uint8Array(0);
      return { data: encoding ? new TextDecoder().decode(bytes) : bytesToBase64(bytes) };
    },

    async writeFile({ path, data, encoding, recursive }) {
      const p = norm(path);
      const parent = parentOf(p);
      if (parent !== '' && !nodes.has(parent)) {
        if (!recursive) throw new Error(`Parent directory does not exist: ${parent}`);
        ensureDirs(parent);
      }
      const bytes = encoding ? new TextEncoder().encode(data) : base64ToBytes(data);
      nodes.set(p, { type: 'file', data: bytes, mtime: now() });
      return undefined;
    },

    async readdir({ path }) {
      const base = norm(path);
      if (base !== '' && nodes.get(base)?.type !== 'directory') throw notFound(path);
      const files: CapFileInfo[] = [];
      for (const [key, node] of nodes) {
        if (parentOf(key) !== base || key === base) continue;
        files.push({
          name: nameOf(key),
          type: node.type,
          size: node.data?.byteLength ?? 0,
          mtime: node.mtime,
        });
      }
      return { files };
    },

    async mkdir({ path, recursive }) {
      const p = norm(path);
      if (nodes.has(p)) throw new Error(`Directory exists: ${path}`);
      const parent = parentOf(p);
      if (parent !== '' && !nodes.has(parent) && !recursive) {
        throw new Error(`Parent directory does not exist: ${parent}`);
      }
      ensureDirs(p);
      return undefined;
    },

    async rmdir({ path, recursive }) {
      const p = norm(path);
      if (nodes.get(p)?.type !== 'directory') throw notFound(path);
      for (const key of [...nodes.keys()]) {
        if (key === p || key.startsWith(`${p}/`)) {
          if (key !== p && !recursive) throw new Error('Directory is not empty');
          nodes.delete(key);
        }
      }
      return undefined;
    },

    async deleteFile({ path }) {
      const p = norm(path);
      if (nodes.get(p)?.type !== 'file') throw notFound(path);
      nodes.delete(p);
      return undefined;
    },

    async rename({ from, to }) {
      const a = norm(from);
      const b = norm(to);
      const node = nodes.get(a);
      if (!node) throw notFound(from);
      ensureDirs(parentOf(b));
      for (const key of [...nodes.keys()]) {
        if (key === a) {
          nodes.set(b, node);
          nodes.delete(a);
        } else if (key.startsWith(`${a}/`)) {
          nodes.set(b + key.slice(a.length), nodes.get(key)!);
          nodes.delete(key);
        }
      }
      return undefined;
    },

    async stat({ path }) {
      const node = nodes.get(norm(path));
      if (!node) throw notFound(path);
      return { type: node.type, size: node.data?.byteLength ?? 0, mtime: node.mtime };
    },
  };
}
