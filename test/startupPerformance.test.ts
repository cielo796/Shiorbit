import { describe, expect, it, vi } from 'vitest';
import { MemoryAdapter } from '../src/adapters/memory';
import { VaultService } from '../src/core/vault/VaultService';
import { Indexer } from '../src/core/index/Indexer';
import { VaultSync } from '../src/ui/vaultSync';

describe('起動と外部変更の負荷抑制', () => {
  it('起動時一覧を索引・監視で共有し、走査後の追加も次回検知する', async () => {
    const adapter = new MemoryAdapter('T');
    await adapter.write('a.md', '[[b]]');
    const vault = new VaultService(adapter);
    const index = new Indexer(vault);
    const list = vi.spyOn(adapter, 'list');
    const entries = await vault.listAll(true);
    await index.rebuild(undefined, false, entries);
    await adapter.write('b.md', '# B');
    vault.startWatching({ initialEntries: entries, intervalMs: 120000 });
    try {
      expect(list).toHaveBeenCalledTimes(1);
      expect(await vault.poll()).toEqual([{ type: 'create', path: 'b.md' }]);
      expect(list).toHaveBeenCalledTimes(2);
    } finally { vault.dispose(); index.dispose(); }
  });

  it('100件追加でもツリー再走査・索引通知は各1回、削除・再作成も最終状態になる', async () => {
    const adapter = new MemoryAdapter('T');
    const vault = new VaultService(adapter);
    const index = new Indexer(vault);
    const refreshTree = vi.fn(async () => {});
    const applyExternal = vi.fn(async () => {});
    const changed = vi.fn();
    index.onChange(changed);
    const sync = new VaultSync({ index: () => index, refreshTree, applyExternal, toast: vi.fn() });
    for (let i = 0; i < 100; i++) await adapter.write(`${i}.md`, '# Note\n[[0]]');
    await Promise.all(Array.from({ length: 100 }, (_, i) => sync.handle({ type: 'create', path: `${i}.md` })));
    expect(index.stats().notes).toBe(100);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(refreshTree).toHaveBeenCalledTimes(1);
    await adapter.remove('1.md');
    await Promise.all([
      sync.handle({ type: 'modify', path: '1.md' }),
      sync.handle({ type: 'delete', path: '1.md' }),
      sync.handle({ type: 'delete', path: '0.md' }),
      sync.handle({ type: 'create', path: '0.md' }),
    ]);
    expect(index.stats().notes).toBe(99);
    expect(applyExternal).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('反映中に来た変更を次便で処理し、Vault切替前の通知は破棄する', async () => {
    const adapter = new MemoryAdapter('T');
    const index = new Indexer(new VaultService(adapter));
    const next = new Indexer(new VaultService(new MemoryAdapter('Next')));
    let active = index;
    let release!: () => void;
    const applyExternal = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const refreshTree = vi.fn(async () => {});
    const sync = new VaultSync({ index: () => active, refreshTree, applyExternal, toast: vi.fn() });
    await adapter.write('a.md', '# A');
    const running = sync.handle({ type: 'modify', path: 'a.md' });
    await Promise.resolve();
    await adapter.write('b.md', '# B');
    const queued = sync.handle({ type: 'create', path: 'b.md' });
    release();
    await Promise.all([running, queued]);
    expect(index.stats().notes).toBe(2);
    expect(refreshTree).toHaveBeenCalledTimes(1);
    const stale = sync.handle({ type: 'create', path: 'a.md' });
    active = next;
    await stale;
    expect(next.stats().notes).toBe(0);
  });
});
