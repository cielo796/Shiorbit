import { describe, expect, it } from 'vitest';
import { createCapacitorAdapter } from '../src/adapters/capacitor';
import { createCapacitorKvStore } from '../src/adapters/capacitorKv';
import { createFakeCapacitorFs } from './fakeCapacitorFs';
import { runAdapterContract } from './adapterContract';
import { VaultService } from '../src/core/vault/VaultService';
import { Indexer } from '../src/core/index/Indexer';

/**
 * iOS / Android 用アダプタを、@capacitor/filesystem を真似た偽プラグインで検証する。
 * 実機が無くても、契約を満たしているかはここで確かめられる。
 */
runAdapterContract('CapacitorAdapter (偽プラグイン)', {
  create: async () =>
    createCapacitorAdapter(createFakeCapacitorFs(), { subdir: 'MyVault', name: 'MyVault' }),
});

describe('CapacitorAdapter — モバイル固有の事情', () => {
  it('Documents の下のサブフォルダを Vault にする', async () => {
    const fs = createFakeCapacitorFs();
    const adapter = createCapacitorAdapter(fs, { subdir: 'MyVault' });
    await adapter.write('AI/Ollama.md', '# Ollama');

    // プラグインから見たパスには subdir が付く（Vault 相対パスには出てこない）
    expect(fs.dump()).toContain('MyVault/AI/Ollama.md');
    expect((await adapter.list('', true)).map((e) => e.path)).toContain('AI/Ollama.md');
  });

  it('watch は非対応と名乗る（VaultService がポーリングに落とす）', () => {
    const adapter = createCapacitorAdapter(createFakeCapacitorFs(), {});
    expect(adapter.caps.watch).toBe(false);
    expect(adapter.caps.realFolder).toBe(true);
    expect(adapter.watch).toBeUndefined();
  });

  it('ポーリングで外部変更を拾える', async () => {
    const fs = createFakeCapacitorFs();
    const adapter = createCapacitorAdapter(fs, {});
    const vault = new VaultService(adapter, { mtimeToleranceMs: 0 });

    await adapter.write('a.md', 'v1');
    expect(await vault.poll()).toEqual([{ type: 'create', path: 'a.md' }]);
    await adapter.write('a.md', 'v2');
    expect(await vault.poll()).toEqual([{ type: 'modify', path: 'a.md' }]);
  });

  it('アプリ本体（VaultService と Indexer）がそのまま動く', async () => {
    const adapter = createCapacitorAdapter(createFakeCapacitorFs(), { name: 'iPhone Vault' });
    const vault = new VaultService(adapter, { mtimeToleranceMs: 0 });
    const index = new Indexer(vault);

    await adapter.write('AI/Ollama.md', '# Ollama\n[[LocalLLM]] と [[MCP]]\n');
    await adapter.write('AI/LocalLLM.md', '# LocalLLM\n');
    await index.rebuild();

    expect(index.backlinks('AI/LocalLLM.md').map((b) => b.from)).toEqual(['AI/Ollama.md']);
    expect(index.unresolved().map((g) => g.name)).toEqual(['MCP']);
    expect((await index.searchNotes('Ollama')).length).toBeGreaterThan(0);
  });
});

describe('CapacitorKvStore', () => {
  it('保存して読み直せる', async () => {
    const kv = createCapacitorKvStore(createFakeCapacitorFs());
    await kv.set('index:MyVault', { version: 2, entries: [] });
    expect(await kv.get('index:MyVault')).toEqual({ version: 2, entries: [] });
  });

  it('無いキーは null', async () => {
    expect(await createCapacitorKvStore(createFakeCapacitorFs()).get('なし')).toBeNull();
  });

  it('削除できる', async () => {
    const kv = createCapacitorKvStore(createFakeCapacitorFs());
    await kv.set('k', 1);
    await kv.delete('k');
    expect(await kv.get('k')).toBeNull();
  });

  it('キャッシュを使った差分インデックスがモバイルでも効く', async () => {
    const fs = createFakeCapacitorFs();
    const adapter = createCapacitorAdapter(fs, {});
    const vault = new VaultService(adapter, { mtimeToleranceMs: 0 });
    const cache = createCapacitorKvStore(fs);

    await adapter.write('a.md', '# A\n[[B]]\n');
    await adapter.write('b.md', '# B\n');

    const first = new Indexer(vault, { cache, persistDelayMs: 0 });
    await first.rebuild();
    expect(first.report).toMatchObject({ scanned: 2, reused: 0 });
    await first.flush();

    const second = new Indexer(vault, { cache, persistDelayMs: 0 });
    await second.rebuild();
    expect(second.report).toMatchObject({ scanned: 0, reused: 2 });
    expect(second.backlinks('b.md').map((b) => b.from)).toEqual(['a.md']);
  });
});
