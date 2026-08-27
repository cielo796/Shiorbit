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

describe('IPC 越しのエラー（Electron）', () => {
  /** ipcMain.handle は message だけを渡し、error.code は落とす。 */
  function bridgeThatFails(message: string): Parameters<typeof createNodeAdapter>[0] {
    const fail = (): never => {
      throw new Error(message);
    };
    return {
      readText: fail,
      readBytes: fail,
      writeText: fail,
      writeBytes: fail,
      readDir: fail,
      stat: fail,
      mkdirp: fail,
      remove: fail,
      rename: fail,
    } as unknown as Parameters<typeof createNodeAdapter>[0];
  }

  it('メッセージの先頭のコードを読んで ENOENT を見分ける', async () => {
    const adapter = createNodeAdapter(
      bridgeThatFails("ENOENT: no such file or directory, open 'x'"),
      'C:/vault',
      'T',
    );

    await expect(adapter.read('missing.md')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('Electron が付ける前置きが入っていても読める', async () => {
    const adapter = createNodeAdapter(
      bridgeThatFails("Error occurred in handler for 'fs:readText': ENOENT: no such file"),
      'C:/vault',
      'T',
    );

    await expect(adapter.read('missing.md')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('コードが分からないものは入出力エラーのままにする', async () => {
    const adapter = createNodeAdapter(bridgeThatFails('disk on fire'), 'C:/vault', 'T');

    await expect(adapter.read('x.md')).rejects.toMatchObject({ code: 'EIO' });
  });
});
