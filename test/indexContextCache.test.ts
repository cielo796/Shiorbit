import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryAdapter } from '../src/adapters/memory';
import { MemoryKeyValueStore } from '../src/adapters/memoryKv';
import { VaultService } from '../src/core/vault/VaultService';
import { Indexer } from '../src/core/index/Indexer';
import { cacheKey, legacyCacheKey, type CachedIndex, validateCache } from '../src/core/index/IndexCache';
import { MAX_CONTEXT_LENGTH } from '../src/core/text/excerpt';

const indexes: Indexer[] = [];
afterEach(() => { indexes.splice(0).forEach(index => index.dispose()); vi.restoreAllMocks(); });

async function setup(source = '<a href="b.md">読みやすい攻略</a>') {
  const adapter = new MemoryAdapter('Bounded');
  await adapter.write('a.html', source);
  await adapter.write('b.md', '# B');
  const store = new MemoryKeyValueStore();
  const create = () => {
    const index = new Indexer(new VaultService(adapter), { cache: store, persistDelayMs: 60000 });
    indexes.push(index);
    return index;
  };
  return { store, create };
}

describe('リンク文脈と旧巨大キャッシュの移行', () => {
  it('8MB一行HTML・26参照を短い文脈で保存し、復元・検索・リンク位置も保つ', async () => {
    const source = `<img src="data:image/png;base64,${'A'.repeat(8 * 1024 * 1024)}">`
      + Array.from({ length: 26 }, (_, at) => `<a href="b.md">攻略 ${at}</a>`).join('');
    const { store, create } = await setup(source);
    const index = create();
    await index.rebuild();
    await index.flush();
    const stored = (await store.get<CachedIndex>(cacheKey('Bounded')))!;
    expect(JSON.stringify(stored).length).toBeLessThan(40000);
    for (const backlink of index.backlinks('b.md')) {
      expect(backlink.context.length).toBeLessThanOrEqual(MAX_CONTEXT_LENGTH);
      expect(backlink.context).not.toMatch(/base64|AAAA|<img/);
      expect(source.slice(backlink.ref.from, backlink.ref.to)).toBe('b.md');
    }
    expect(index.backlinks('b.md')).toHaveLength(26);
    const restored = create();
    await restored.rebuild();
    expect(restored.report.reused).toBe(2);
    expect(restored.backlinks('b.md')[0]?.context).toBe('攻略 0');
    expect((await restored.searchNotes('攻略'))[0]?.path).toBe('a.html');
  });

  it('旧キーをgetせず、新索引の保存後だけ旧キーを削除する', async () => {
    const { store, create } = await setup();
    const old = legacyCacheKey('Bounded');
    await store.set(old, { oldLargeValue: 'cache' });
    await store.set(legacyCacheKey('Other'), { preserved: true });
    await store.set('vault-setting', { preserved: true });
    const get = vi.spyOn(store, 'get');
    const remove = vi.spyOn(store, 'delete');
    const index = create();
    await index.rebuild();
    expect(get.mock.calls.some(([key]) => key === old)).toBe(false);
    expect(remove).not.toHaveBeenCalled();
    await index.flush();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(old);
    expect(await store.get(old)).toBeNull();
    expect(await store.get(cacheKey('Bounded'))).not.toBeNull();
    expect(await store.get(legacyCacheKey('Other'))).toEqual({ preserved: true });
    expect(await store.get('vault-setting')).toEqual({ preserved: true });
  });

  it('新索引の保存が失敗したら旧キーを消さず、再試行できる', async () => {
    const { store, create } = await setup();
    await store.set(legacyCacheKey('Bounded'), { old: true });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(store, 'set').mockRejectedValueOnce(new Error('Storage failure'));
    const remove = vi.spyOn(store, 'delete');
    const index = create();
    await index.rebuild();
    await index.flush();
    expect(remove).not.toHaveBeenCalled();
    expect(await store.get(legacyCacheKey('Bounded'))).toEqual({ old: true });
    await index.flush();
    expect(await store.get(cacheKey('Bounded'))).not.toBeNull();
    expect(await store.get(legacyCacheKey('Bounded'))).toBeNull();
  });

  it('旧索引の整理に失敗しても新索引は使える', async () => {
    const { store, create } = await setup();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(store, 'delete').mockRejectedValueOnce(new Error('Delete failure'));
    const index = create();
    await index.rebuild();
    await index.flush();
    const restored = create();
    await restored.rebuild();
    expect(restored.report.reused).toBe(2);
  });

  it('現行形式でも上限超過の文脈を含むキャッシュは再構築する', async () => {
    const { store, create } = await setup();
    const first = create();
    await first.rebuild();
    await first.flush();
    const stored = (await store.get<CachedIndex>(cacheKey('Bounded')))!;
    stored.entries.find(entry => entry.out.length)!.out[0]!.context = 'x'.repeat(10000);
    expect(validateCache(stored, 'Bounded')).toBeNull();
    await store.set(cacheKey('Bounded'), stored);
    const next = create();
    await next.rebuild();
    expect(next.report.scanned).toBe(2);
    expect(next.backlinks('b.md')[0]?.context).toBe('読みやすい攻略');
  });
});
