import { describe, expect, it } from 'vitest';
import { MemoryKeyValueStore } from '../src/adapters/memoryKv';
import { Indexer } from '../src/core/index/Indexer';
import { cacheKey } from '../src/core/index/IndexCache';
import { VaultService } from '../src/core/vault/VaultService';
import { buildBenchVault, countCalls } from './support/benchVault';

/**
 * 設計書 §10 の数値目標を、テストで毎回確かめる（ROADMAP 7.1）。
 *
 * 実測はマシンによって上下するので、しきい値は**目標の数倍**に置いてある。
 * ここで見たいのは「桁が変わっていないか」であって、細かい前後ではない。
 * 数字が跳ねたら、まずこのテストが落ちる。
 */
const NOTES = 10_000;
const TIMEOUT = 180_000;

async function setup(): Promise<{ vault: VaultService; index: Indexer; cache: MemoryKeyValueStore }> {
  const adapter = await buildBenchVault({ notes: NOTES });
  const vault = new VaultService(adapter, { mtimeToleranceMs: 0 });
  const cache = new MemoryKeyValueStore();
  return { vault, index: new Indexer(vault, { cache }), cache };
}

describe(`性能 — ${NOTES} ノート（設計書 §10）`, () => {
  it('初回インデックスが現実的な時間で終わり、リンクが張られる', async () => {
    const { index } = await setup();

    const started = Date.now();
    await index.rebuild();
    const ms = Date.now() - started;

    const stats = index.stats();
    expect(stats.notes).toBe(NOTES);
    expect(stats.links).toBeGreaterThan(NOTES * 4);
    // 初回だけの費用。Worker 化（7.2）の前後で比べられるように記録する。
    expect(ms).toBeLessThan(120_000);
  }, TIMEOUT);

  it('2回目の起動はキャッシュを使い、ほとんど読み直さない', async () => {
    const { vault, index, cache } = await setup();
    await index.rebuild();
    await index.flush();

    const counted = countCalls((vault as unknown as { adapter: never }).adapter);
    const second = new Indexer(new VaultService(counted.adapter, { mtimeToleranceMs: 0 }), { cache });

    const started = Date.now();
    await second.rebuild();
    const ms = Date.now() - started;

    expect(second.stats().notes).toBe(NOTES);
    expect(second.report.reused).toBe(NOTES);
    expect(second.report.scanned).toBe(0);
    // 本文を1件も読まずに立ち上がる。
    expect(counted.counts.read).toBe(0);
    expect(ms).toBeLessThan(10_000);
  }, TIMEOUT);

  it('ノート1件の保存が索引へすぐ反映される', async () => {
    const { vault, index } = await setup();
    await index.rebuild();

    const path = 'topic0/note0.md';
    await vault.writeNote(path, '# 変更後\n\n[[note1]] だけを指す。');

    const started = Date.now();
    await index.updateNote(path);
    const ms = Date.now() - started;

    expect(index.outgoing(path)).toHaveLength(1);
    expect(ms).toBeLessThan(1_000);
  }, TIMEOUT);

  it('検索の初回表示が本文を読まない', async () => {
    const adapter = await buildBenchVault({ notes: NOTES });
    const counted = countCalls(adapter);
    const index = new Indexer(new VaultService(counted.adapter, { mtimeToleranceMs: 0 }));
    await index.rebuild();
    counted.reset();

    const started = Date.now();
    const hits = await index.searchNotes('実行環境');
    const ms = Date.now() - started;

    expect(hits.length).toBeGreaterThan(0);
    // 抜粋は画面に出た行のぶんだけ、あとから取りに行く（ROADMAP 7.5）。
    expect(counted.counts.read).toBe(0);
    expect(ms).toBeLessThan(2_000);

    expect(await index.snippetFor(hits[0]!.path, '実行環境')).not.toBe('');
    expect(counted.counts.read).toBe(1);
  }, TIMEOUT);

  it('索引のキャッシュが膨らみすぎない', async () => {
    const { index, cache } = await setup();
    await index.rebuild();
    await index.flush();

    const stored = await cache.get(cacheKey('Bench'));
    const megabytes = new TextEncoder().encode(JSON.stringify(stored)).length / 1024 / 1024;

    // 保存のたびに直列化するので、桁が変わったら気づけるようにしておく。
    expect(megabytes).toBeLessThan(30);
  }, TIMEOUT);

  it('ポーリング1周の I/O がファイル数に比例して増えない', async () => {
    const adapter = await buildBenchVault({ notes: 1_000 });
    const counted = countCalls(adapter);
    const vault = new VaultService(counted.adapter, { mtimeToleranceMs: 0 });

    await vault.poll();
    counted.reset();
    await vault.poll();

    // 一覧で mtime まで取れるアダプタでは、ファイルごとの stat は要らない。
    expect(counted.counts.list).toBeLessThanOrEqual(2);
    expect(counted.counts.stat).toBeLessThanOrEqual(10);
    expect(counted.counts.read).toBe(0);
  }, TIMEOUT);
});
