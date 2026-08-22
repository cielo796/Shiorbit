import { describe, expect, it } from 'vitest';
import { MemoryAdapter } from '../src/adapters/memory';
import { runAdapterContract } from './adapterContract';

runAdapterContract('MemoryAdapter', {
  create: async () => new MemoryAdapter('TestVault'),
});

describe('MemoryAdapter — 固有の振る舞い', () => {
  it('rename がディレクトリごと移動する', async () => {
    const a = new MemoryAdapter('T');
    await a.write('AI/x.md', '1');
    await a.write('AI/sub/y.md', '2');
    await a.rename('AI', 'Tech');
    expect(await a.read('Tech/x.md')).toBe('1');
    expect(await a.read('Tech/sub/y.md')).toBe('2');
    expect(await a.exists('AI')).toBe(false);
  });

  it('実フォルダではないと名乗る（UI がデモモードだと分かる）', () => {
    expect(new MemoryAdapter('T').caps.realFolder).toBe(false);
  });
});
