import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryAdapter } from '../src/adapters/memory';
import { searchText } from '../src/core/index/searchText';
import { SearchService } from '../src/core/index/SearchService';
import { scanDocument } from '../src/core/index/scanDocument';
import { Indexer } from '../src/core/index/Indexer';
import { MemoryKeyValueStore } from '../src/adapters/memoryKv';
import { VaultService } from '../src/core/vault/VaultService';

afterEach(() => vi.useRealTimers());

describe('検索索引の画像・非本文除外', () => {
  it('HTMLはCSS・スクリプト・コメント・属性を除き、本文と実体参照を検索対象にする', () => {
    const source = '<!doctype html><style>.noise{}</style><script>secret()</script><!-- hidden -->'
      + '<h1>日本語 &amp; &#65;&#x42;</h1><p title="a > b">攻略 &lt;test&gt;</p>'
      + '<template>templateNoise</template><noscript>fallbackNoise</noscript>';
    const text = searchText('a.HTML', source);
    expect(text).toContain('日本語 & AB');
    expect(text).toContain('攻略 <test>');
    expect(text).not.toMatch(/noise|secret|hidden|title|doctype/i);
  });

  it('閉じられていないコメントやタグを繰り返し解析せず終了する', () => {
    expect(searchText('a.htm', 'hello<!-- unfinished')).toBe('hello');
    expect(searchText('a.htm', 'hello<script>unfinished')).toBe('hello ');
    expect(searchText('a.htm', '1 < 2 &unknown;')).toBe('1 < 2 &unknown;');
    expect(searchText('a.htm', '<p>&#1114112; &#xD800;</p>')).toContain('\ufffd \ufffd');
  });

  it('Markdownの本文・画像説明・URLを保ち、base64だけを索引から除く', () => {
    const text = searchText('a.md', '# 攻略\n![マップ](data:image/png;base64,AbCd0123+/==)\nhttps://example.com');
    expect(text).toContain('マップ');
    expect(text).toContain('https://example.com');
    expect(text).not.toContain('AbCd0123');
  });

  it('1MB画像を検索索引に持ち込まず、本文検索と非同期キャッシュ復元を保つ', async () => {
    const source = '<h1>攻略 guide</h1><img src="data:image/png;base64,' + 'AbCd0123+/'.repeat(100000) + '">';
    const search = new SearchService();
    search.put(scanDocument('a.html', source, { mtime: 1, size: source.length }), source);
    const cache = search.serialize();
    expect(cache.length).toBeLessThan(5000);
    expect(search.search('攻略 guide')[0]?.path).toBe('a.html');
    expect(search.search('AbCd0123')).toEqual([]);
    const restored = new SearchService();
    expect(await restored.restore(cache)).toBe(true);
    expect(restored.search('攻略')[0]?.path).toBe('a.html');
  });
});

describe('索引キャッシュの無駄な書き出し抑制', () => {
  it('flushの重複と、変更のない起動復元では再保存しない', async () => {
    const adapter = new MemoryAdapter('Cache');
    await adapter.write('a.md', '# A');
    const store = new MemoryKeyValueStore();
    const set = vi.spyOn(store, 'set');
    const first = new Indexer(new VaultService(adapter), { cache: store });
    const second = new Indexer(new VaultService(adapter), { cache: store });
    try {
      await first.rebuild();
      await Promise.all([first.flush(), first.flush(), first.flush()]);
      expect(set).toHaveBeenCalledTimes(1);
      await first.flush();
      await second.rebuild();
      expect(second.report.reused).toBe(1);
      await second.flush();
      expect(set).toHaveBeenCalledTimes(1);
      await adapter.write('a.md', '# Modified');
      await second.updateNote('a.md');
      await second.flush();
      expect(set).toHaveBeenCalledTimes(2);
    } finally { first.dispose(); second.dispose(); }
  });

  it('保存中の編集は失わず、最新の索引を次便で保存する', async () => {
    const adapter = new MemoryAdapter('Cache');
    await adapter.write('a.md', '# Old');
    const store = new MemoryKeyValueStore();
    const original = store.set.bind(store);
    let release!: () => void;
    vi.spyOn(store, 'set').mockImplementationOnce(async (key, value) => {
      await new Promise<void>(resolve => { release = resolve; });
      await original(key, value);
    });
    const index = new Indexer(new VaultService(adapter), { cache: store });
    try {
      await index.rebuild();
      const saving = index.flush();
      await adapter.write('a.md', '# New');
      await index.updateNote('a.md');
      const latest = index.flush();
      release();
      await Promise.all([saving, latest]);
      expect(store.set).toHaveBeenCalledTimes(2);
      const restored = new Indexer(new VaultService(adapter), { cache: store });
      try {
        await restored.rebuild();
        expect((await restored.searchNotes('New'))[0]?.path).toBe('a.md');
      } finally { restored.dispose(); }
    } finally { index.dispose(); }
  });
});

describe('フォルダ監視の休止と待ち時間', () => {
  it('遅い走査が終わるまでは次の走査を始めず、終了から間隔を空ける', async () => {
    vi.useFakeTimers();
    const adapter = new MemoryAdapter('Slow');
    const original = adapter.list.bind(adapter);
    let release!: () => void;
    const list = vi.spyOn(adapter, 'list').mockImplementationOnce(async (...args) => {
      await new Promise<void>(resolve => { release = resolve; });
      return original(...args);
    });
    const vault = new VaultService(adapter);
    try {
      vault.startWatching({ initialEntries: [], intervalMs: 100 });
      await vi.advanceTimersByTimeAsync(100);
      expect(list).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(list).toHaveBeenCalledTimes(1);
      release();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(99);
      expect(list).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(list).toHaveBeenCalledTimes(2);
    } finally { vault.dispose(); }
  });

  it('バックグラウンドでは走査せず、復帰時は休止中の変更を検知する', async () => {
    vi.useFakeTimers();
    const adapter = new MemoryAdapter('Paused');
    await adapter.write('a.md', '# Old');
    const entries = await adapter.list('', true, true);
    const list = vi.spyOn(adapter, 'list');
    const vault = new VaultService(adapter);
    try {
      vault.startWatching({ initialEntries: entries, intervalMs: 100 });
      vault.setWatchingPaused(true);
      await adapter.write('a.md', '# New');
      await adapter.write('b.md', '# B');
      await vi.advanceTimersByTimeAsync(1000);
      expect(list).not.toHaveBeenCalled();
      vault.setWatchingPaused(false);
      expect(await vault.poll()).toEqual([
        { type: 'modify', path: 'a.md' }, { type: 'create', path: 'b.md' },
      ]);
    } finally { vault.dispose(); }
  });

  it('監視停止後に完了した走査は通知・タイマーを再開しない', async () => {
    vi.useFakeTimers();
    const adapter = new MemoryAdapter('Stop');
    let release!: () => void;
    const list = vi.spyOn(adapter, 'list').mockImplementation(async () => {
      await new Promise<void>(resolve => { release = resolve; });
      return [{ path: 'late.md', name: 'late.md', kind: 'file', mtime: 1 }];
    });
    const vault = new VaultService(adapter);
    const changed = vi.fn();
    vault.on(changed);
    vault.startWatching({ initialEntries: [], intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    vault.stopWatching();
    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(changed).not.toHaveBeenCalled();
    expect(list).toHaveBeenCalledTimes(1);
    vault.dispose();
  });
});
