import { describe, expect, it } from 'vitest';
import { MemoryAdapter } from '../src/adapters/memory';
import { VaultService } from '../src/core/vault/VaultService';
import { Indexer } from '../src/core/index/Indexer';
import { buildGraph } from '../src/core/graph/buildGraph';
import { computeLayout, createLayout, nodeRadius } from '../src/core/graph/layout';
import { unresolvedId, type GraphData, type GraphInput } from '../src/core/graph/types';

const input: GraphInput[] = [
  { path: 'A.md', basename: 'A', links: [{ target: 'B', resolved: 'B.md' }, { target: 'X', resolved: null }] },
  { path: 'B.md', basename: 'B', links: [{ target: 'C', resolved: 'C.md' }, { target: 'A', resolved: 'A.md' }] },
  { path: 'C.md', basename: 'C', links: [{ target: 'D', resolved: 'D.md' }] },
  { path: 'D.md', basename: 'D', links: [] },
  { path: 'Lonely.md', basename: 'Lonely', links: [{ target: 'Lonely', resolved: 'Lonely.md' }] },
];

const edges = (g: GraphData): string[] => g.links.map((l) => `${l.source}-${l.target}`).sort();

describe('buildGraph', () => {
  it('ノートをノードに、リンクを辺にする', () => {
    const g = buildGraph(input);
    expect(g.nodes.map((n) => n.id)).toEqual(['A.md', 'B.md', 'C.md', 'D.md', 'Lonely.md']);
    expect(edges(g)).toEqual(['A.md-B.md', 'B.md-C.md', 'C.md-D.md']);
  });

  it('相互リンクは1本にまとめる（無向グラフ）', () => {
    // A→B と B→A があるが辺は1本
    expect(edges(buildGraph(input)).filter((e) => e === 'A.md-B.md')).toHaveLength(1);
  });

  it('自分自身へのリンクは辺にしない', () => {
    const g = buildGraph(input);
    expect(g.nodes.find((n) => n.id === 'Lonely.md')?.degree).toBe(0);
    expect(edges(g).some((e) => e.includes('Lonely'))).toBe(false);
  });

  it('次数を数える', () => {
    const g = buildGraph(input);
    expect(g.nodes.find((n) => n.id === 'B.md')?.degree).toBe(2);
    expect(g.nodes.find((n) => n.id === 'D.md')?.degree).toBe(1);
  });

  it('未解決リンクは既定では出さず、指定すると出す', () => {
    expect(buildGraph(input).nodes.some((n) => n.kind === 'unresolved')).toBe(false);

    const g = buildGraph(input, { includeUnresolved: true });
    const x = g.nodes.find((n) => n.id === unresolvedId('X'));
    expect(x).toMatchObject({ label: 'X', kind: 'unresolved', degree: 1 });
    expect(edges(g)).toContain(`A.md-${unresolvedId('X')}`);
  });

  it('フォーカスで深さ1のローカルグラフを取り出す', () => {
    const g = buildGraph(input, { focus: { id: 'B.md', depth: 1 } });
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['A.md', 'B.md', 'C.md']);
  });

  it('フォーカスの深さ2で1ホップ先まで広がる', () => {
    const g = buildGraph(input, { focus: { id: 'B.md', depth: 2 } });
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['A.md', 'B.md', 'C.md', 'D.md']);
  });

  it('孤立ノートのローカルグラフは自分だけ', () => {
    const g = buildGraph(input, { focus: { id: 'Lonely.md', depth: 2 } });
    expect(g.nodes.map((n) => n.id)).toEqual(['Lonely.md']);
    expect(g.links).toEqual([]);
  });

  it('存在しないノートにフォーカスすると空', () => {
    expect(buildGraph(input, { focus: { id: 'なし.md', depth: 1 } })).toEqual({ nodes: [], links: [] });
  });

  it('名前で絞り込むと一致ノードとその隣接だけ残る', () => {
    const g = buildGraph(input, { query: 'd' });
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['C.md', 'D.md']);
  });

  it('maxNodes を超えたら次数の高い順に残す', () => {
    // 次数は B=2, C=2, A=1, D=1, Lonely=0
    const g = buildGraph(input, { maxNodes: 2 });
    expect(g.nodes).toHaveLength(2);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['B.md', 'C.md']);
  });

  it('入力が空なら空グラフ', () => {
    expect(buildGraph([])).toEqual({ nodes: [], links: [] });
  });
});

describe('Indexer との接続', () => {
  it('実際の Vault からグラフを組み立てられる', async () => {
    const adapter = new MemoryAdapter('T');
    const vault = new VaultService(adapter, { mtimeToleranceMs: 0 });
    const index = new Indexer(vault);
    await adapter.write('AI/Ollama.md', '# Ollama\n[[LocalLLM]] と [[MCP]]\n');
    await adapter.write('AI/LocalLLM.md', '# LocalLLM\n');
    await index.rebuild();

    const g = buildGraph(index.graphInput(), { includeUnresolved: true });
    expect(g.nodes.map((n) => n.label).sort()).toEqual(['LocalLLM', 'MCP', 'Ollama']);
    expect(g.nodes.find((n) => n.label === 'MCP')?.kind).toBe('unresolved');
    expect(g.links).toHaveLength(2);
  });
});

describe('力学レイアウト', () => {
  const data = buildGraph(input);
  const opts = { width: 800, height: 600 };

  it('すべてのノードに座標が付く', () => {
    const pos = computeLayout(data, opts, 60);
    expect(pos.ids).toHaveLength(data.nodes.length);
    expect(pos.xs).toHaveLength(data.nodes.length);
    for (let i = 0; i < pos.ids.length; i++) {
      expect(Number.isFinite(pos.xs[i])).toBe(true);
      expect(Number.isFinite(pos.ys[i])).toBe(true);
    }
  });

  it('同じ入力なら同じ結果になる（再現性がある）', () => {
    const a = computeLayout(data, opts, 40);
    const b = computeLayout(data, opts, 40);
    expect([...a.xs]).toEqual([...b.xs]);
    expect([...a.ys]).toEqual([...b.ys]);
  });

  it('つながったノードは離れたノートより近くに置かれる', () => {
    const pos = computeLayout(data, opts, 300);
    const at = (id: string): { x: number; y: number } => {
      const i = pos.ids.indexOf(id);
      return { x: pos.xs[i]!, y: pos.ys[i]! };
    };
    const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
      Math.hypot(a.x - b.x, a.y - b.y);

    // A-B は直接つながっている。A-Lonely はどこともつながっていない。
    expect(dist(at('A.md'), at('B.md'))).toBeLessThan(dist(at('A.md'), at('Lonely.md')));
  });

  it('計算を進めると収束していく', () => {
    const engine = createLayout(data, opts);
    const before = engine.alpha();
    engine.tick(100);
    expect(engine.alpha()).toBeLessThan(before);
    engine.stop();
  });

  it('ノードを固定できる（ドラッグ用）', () => {
    const engine = createLayout(data, opts);
    engine.pin('A.md', 123, 456);
    const pos = engine.tick(30);
    const i = pos.ids.indexOf('A.md');
    expect(pos.xs[i]).toBe(123);
    expect(pos.ys[i]).toBe(456);
    engine.stop();
  });

  it('次数が大きいほど半径が大きい', () => {
    expect(nodeRadius(0)).toBeLessThan(nodeRadius(5));
    expect(nodeRadius(5)).toBeLessThan(nodeRadius(40));
    expect(nodeRadius(10_000)).toBeLessThan(14); // 上限がある
  });
});

describe('性能 — 設計書 §12 の完了条件 (1000ノード)', () => {
  it('1000ノード・約2000辺のレイアウトが現実的な時間で終わる', () => {
    const big: GraphInput[] = [];
    for (let i = 0; i < 1000; i++) {
      const links = [
        { target: `n${(i + 1) % 1000}`, resolved: `n${(i + 1) % 1000}.md` },
        { target: `n${(i * 7 + 3) % 1000}`, resolved: `n${(i * 7 + 3) % 1000}.md` },
      ];
      big.push({ path: `n${i}.md`, basename: `n${i}`, links });
    }

    const graph = buildGraph(big);
    expect(graph.nodes).toHaveLength(1000);
    expect(graph.links.length).toBeGreaterThan(1500);

    const started = Date.now();
    const pos = computeLayout(graph, { width: 1200, height: 900 }, 200);
    const ms = Date.now() - started;

    expect(pos.ids).toHaveLength(1000);
    // Barnes-Hut 近似のおかげで 1000 ノード x 200 ステップでもこの程度で収まる
    expect(ms).toBeLessThan(5000);
    console.info(`  1000ノード x 200ステップ: ${ms}ms (1ステップあたり ${(ms / 200).toFixed(2)}ms)`);
  });
});
