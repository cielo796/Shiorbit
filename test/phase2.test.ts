import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryAdapter } from '../src/adapters/memory';
import { MemoryKeyValueStore } from '../src/adapters/memoryKv';
import { VaultService } from '../src/core/vault/VaultService';
import { Indexer } from '../src/core/index/Indexer';
import { cacheKey } from '../src/core/index/IndexCache';
import { DEFAULT_SETTINGS, SETTINGS_PATH, Settings, normalize } from '../src/core/settings/Settings';
import { CommandRegistry } from '../src/core/commands/CommandRegistry';
import { dailyPath, formatDate } from '../src/core/notes/date';
import { applyTemplate } from '../src/core/notes/template';

describe('Settings', () => {
  let adapter: MemoryAdapter;
  let settings: Settings;

  beforeEach(() => {
    adapter = new MemoryAdapter('T');
    settings = new Settings(new VaultService(adapter, { mtimeToleranceMs: 0 }));
  });

  it('未作成なら既定値になる', async () => {
    await settings.load();
    expect(settings.data).toEqual(DEFAULT_SETTINGS);
  });

  it('保存して読み直せる', async () => {
    await settings.load();
    await settings.update({ theme: 'light', dailyFolder: '日誌' });

    const reloaded = new Settings(new VaultService(adapter, { mtimeToleranceMs: 0 }));
    await reloaded.load();
    expect(reloaded.data.theme).toBe('light');
    expect(reloaded.data.dailyFolder).toBe('日誌');
    expect(reloaded.data.livePreview).toBe(DEFAULT_SETTINGS.livePreview);
  });

  it('Vault の中 (.shiorbit) に置かれ、ツリーには出ない', async () => {
    await settings.load();
    await settings.save();
    expect(await adapter.exists(SETTINGS_PATH)).toBe(true);

    const vault = new VaultService(adapter, { mtimeToleranceMs: 0 });
    expect((await vault.listAll()).map((e) => e.path)).not.toContain(SETTINGS_PATH);
  });

  it('旧 .obidisan の設定を .shiorbit へ移行する', async () => {
    await adapter.write('.obidisan/settings.json', JSON.stringify({ theme: 'light', dailyFolder: '旧日誌' }));

    await settings.load();

    expect(settings.data.theme).toBe('light');
    expect(settings.data.dailyFolder).toBe('旧日誌');
    expect(await adapter.exists(SETTINGS_PATH)).toBe(true);
    expect(await adapter.exists('.obidisan/settings.json')).toBe(true);
  });

  it('壊れた値は既定値で埋める', () => {
    expect(normalize({ theme: 'purple', dailyFolder: '', livePreview: 'yes' })).toEqual(DEFAULT_SETTINGS);
    expect(normalize(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('JSON が壊れていても落ちずに既定値へ戻る', async () => {
    await adapter.write(SETTINGS_PATH, '{ これは JSON ではない');
    await settings.load();
    expect(settings.data).toEqual(DEFAULT_SETTINGS);
  });
});

describe('日付とテンプレート', () => {
  const d = new Date(2026, 7, 20, 9, 5, 3); // 2026-08-20 09:05:03 (木)

  it('formatDate', () => {
    expect(formatDate(d, 'YYYY-MM-DD')).toBe('2026-08-20');
    expect(formatDate(d, 'YYYY年M月D日(ddd)')).toBe('2026年8月20日(木)');
    expect(formatDate(d, 'HH:mm:ss')).toBe('09:05:03');
  });

  it('dailyPath', () => {
    expect(dailyPath(d, 'Daily', 'YYYY-MM-DD')).toBe('Daily/2026-08-20.md');
    expect(dailyPath(d, '', 'YYYY-MM-DD')).toBe('2026-08-20.md');
    expect(dailyPath(d, '/日誌/', 'YYYY/MM/DD')).toBe('日誌/2026/08/20.md');
  });

  it('applyTemplate', () => {
    const out = applyTemplate('# {{title}}\n{{date}} {{time}}\n{{date:YYYY年M月D日}}\n{{unknown}}', {
      title: '会議メモ',
      date: d,
    });
    expect(out).toBe('# 会議メモ\n2026-08-20 09:05\n2026年8月20日\n{{unknown}}');
  });
});

describe('CommandRegistry', () => {
  it('登録・一覧・実行ができ、無効なものは出ない', async () => {
    const registry = new CommandRegistry();
    let ran = '';
    registry.register(
      { id: 'a', name: 'A', run: () => { ran = 'a'; } },
      { id: 'b', name: 'B', run: () => { ran = 'b'; }, available: () => false },
    );

    expect(registry.list().map((c) => c.id)).toEqual(['a']);
    await registry.run('a');
    expect(ran).toBe('a');

    await registry.run('b'); // 無効なので実行されない
    expect(ran).toBe('a');
  });
});

describe('インデックスの永続化 (差分スキャン)', () => {
  let kv: MemoryKeyValueStore;
  let adapter: MemoryAdapter;
  let vault: VaultService;

  const makeIndexer = (): Indexer =>
    new Indexer(vault, { cache: kv, persistDelayMs: 0 });

  beforeEach(async () => {
    kv = new MemoryKeyValueStore();
    adapter = new MemoryAdapter('T');
    vault = new VaultService(adapter, { mtimeToleranceMs: 0 });
    await adapter.write('a.md', '# A\n\n[[B]] を参照。\n');
    await adapter.write('b.md', '# B\n\n本文。\n');
  });

  it('初回は全件スキャンし、2回目はキャッシュを再利用する', async () => {
    const first = makeIndexer();
    await first.rebuild();
    expect(first.report).toMatchObject({ scanned: 2, reused: 0 });
    await first.flush();

    const second = makeIndexer();
    await second.rebuild();
    expect(second.report).toMatchObject({ scanned: 0, reused: 2 });
  });

  it('再利用してもバックリンクと全文検索が効く', async () => {
    const first = makeIndexer();
    await first.rebuild();
    await first.flush();

    const second = makeIndexer();
    await second.rebuild();

    expect(second.backlinks('b.md').map((b) => b.from)).toEqual(['a.md']);
    expect(second.backlinks('b.md')[0]!.context).toBe('[[B]] を参照。');
    expect((await second.searchNotes('本文')).map((r) => r.path)).toEqual(['b.md']);
  });

  it('変わったノートだけ読み直す', async () => {
    const first = makeIndexer();
    await first.rebuild();
    await first.flush();

    await adapter.write('b.md', '# B\n\n[[C]] を追記。\n');

    const second = makeIndexer();
    await second.rebuild();
    expect(second.report).toMatchObject({ scanned: 1, reused: 1 });
    expect(second.unresolved().map((g) => g.name)).toEqual(['C']);
  });

  it('消えたノートは検索索引からも落ちる', async () => {
    const first = makeIndexer();
    await first.rebuild();
    await first.flush();

    await adapter.remove('b.md');

    const second = makeIndexer();
    await second.rebuild();
    expect(second.report).toMatchObject({ reused: 1 });
    expect(await second.searchNotes('本文')).toEqual([]);
    expect(second.unresolved().map((g) => g.name)).toEqual(['B']);
  });

  it('形式が古いキャッシュは捨てて全件スキャンする', async () => {
    await kv.set(cacheKey('T'), { version: 0, vault: 'T', entries: [], search: '' });
    const index = makeIndexer();
    await index.rebuild();
    expect(index.report).toMatchObject({ scanned: 2, reused: 0 });
  });

  it('別 Vault のキャッシュは使わない', async () => {
    const first = makeIndexer();
    await first.rebuild();
    await first.flush();

    const other = new VaultService(new MemoryAdapter('別のVault'), { mtimeToleranceMs: 0 });
    const index = new Indexer(other, { cache: kv, persistDelayMs: 0 });
    await index.rebuild();
    expect(index.report.reused).toBe(0);
  });

  it('force=true で明示的に作り直せる', async () => {
    const first = makeIndexer();
    await first.rebuild();
    await first.flush();

    const second = makeIndexer();
    await second.rebuild(undefined, true);
    expect(second.report).toMatchObject({ scanned: 2, reused: 0 });
  });

  it('キャッシュを渡さなければ毎回全件スキャンする', async () => {
    const index = new Indexer(vault);
    await index.rebuild();
    expect(index.report).toMatchObject({ scanned: 2, reused: 0 });
  });
});
