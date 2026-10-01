import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Entry } from '../src/core/vault/types';
import { createNodeAdapter } from '../src/adapters/node';
import { createNodeFsBridge } from '../src/adapters/nodeFs';
const { listTree } = createRequire(import.meta.url)('../electron/listTree.cjs') as {
  listTree: (root: string, withStat?: boolean) => Promise<Entry[]>;
};

describe('デスクトップの一括列挙', () => {
  it('空・隠し・ネストしたフォルダを1回のブリッジ呼び出しで返す', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shiorbit-list-'));
    try {
      await mkdir(join(root, 'A', 'Empty'), { recursive: true });
      await mkdir(join(root, '.shiorbit'));
      await writeFile(join(root, 'A', 'note.md'), '# Test');
      await writeFile(join(root, '.shiorbit', 'settings.json'), '{}');
      const bridge = await createNodeFsBridge();
      bridge.listTree = vi.fn(listTree);
      bridge.readDir = vi.fn(bridge.readDir);
      const adapter = createNodeAdapter(bridge, root);
      const all = await adapter.list('', true, true);
      expect(all.map(e => e.path)).toContain('.shiorbit/settings.json');
      expect(all.find(e => e.path === 'A/note.md')).toMatchObject({ mtime: expect.any(Number), size: 6 });
      expect(all.find(e => e.path === 'A/Empty')?.kind).toBe('dir');
      expect(bridge.listTree).toHaveBeenCalledTimes(1);
      expect(bridge.readDir).not.toHaveBeenCalled();
      const sub = await adapter.list('A', true);
      expect(sub.map(e => e.path).sort()).toEqual(['A/Empty', 'A/note.md']);
      expect(sub.find(e => e.kind === 'file')?.mtime).toBeUndefined();
      await expect(adapter.list('Missing', true)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
