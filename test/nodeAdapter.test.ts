import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeAdapter } from '../src/adapters/node';
import { createNodeFsBridge } from '../src/adapters/nodeFs';
import { runAdapterContract } from './adapterContract';

let root = '';

/**
 * Electron / デスクトップ用アダプタを、本物のファイルシステムで検証する。
 *
 * 実機がなくても確かめられる唯一のネイティブ経路なので、ここは実ファイルで通す。
 */
runAdapterContract('NodeAdapter (実ファイルシステム)', {
  create: async () => {
    root = await mkdtemp(join(tmpdir(), 'shiorbit-'));
    return createNodeAdapter(await createNodeFsBridge(), root, 'TestVault');
  },
  cleanup: async () => {
    if (root !== '') await rm(root, { recursive: true, force: true });
    root = '';
  },
});

describe('NodeAdapter — ディスク上の実体を確認する', () => {
  let dir = '';

  beforeEach(async () => {
    if (dir !== '') await rm(dir, { recursive: true, force: true });
    dir = await mkdtemp(join(tmpdir(), 'shiorbit-real-'));
  });

  afterAll(async () => {
    if (dir !== '') await rm(dir, { recursive: true, force: true });
  });

  it('書き込んだノートが本当に .md ファイルとして存在する', async () => {
    const adapter = createNodeAdapter(await createNodeFsBridge(), dir, 'T');
    await adapter.write('AI/Ollama.md', '# Ollama\n[[LocalLLM]]\n');

    const onDisk = await readFile(join(dir, 'AI', 'Ollama.md'), 'utf8');
    expect(onDisk).toBe('# Ollama\n[[LocalLLM]]\n');
  });

  it('外部のツールが書いたファイルをそのまま読める', async () => {
    const adapter = createNodeAdapter(await createNodeFsBridge(), dir, 'T');
    await adapter.mkdir('Daily');
    await writeFile(join(dir, 'Daily', '2026-08-21.md'), '# 外から書いた\n', 'utf8');

    expect(await adapter.read('Daily/2026-08-21.md')).toBe('# 外から書いた\n');
    expect((await adapter.list('', true)).map((e) => e.path).sort()).toEqual([
      'Daily',
      'Daily/2026-08-21.md',
    ]);
  });

  it('caps が実フォルダであることを名乗る', async () => {
    const adapter = createNodeAdapter(await createNodeFsBridge(), dir, 'T');
    expect(adapter.caps.realFolder).toBe(true);
    expect(adapter.id).toBe('node');
  });
});
