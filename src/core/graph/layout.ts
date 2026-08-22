import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type { GraphData, Positions } from './types';

interface SimNode extends SimulationNodeDatum {
  id: string;
  radius: number;
}

type SimLink = SimulationLinkDatum<SimNode>;

export interface LayoutOptions {
  width: number;
  height: number;
  /** リンクの自然長 */
  linkDistance?: number;
  /** 反発力。負の値ほど強く散らばる。 */
  charge?: number;
}

export interface LayoutEngine {
  /** count 回だけ計算を進めて、現在の座標を返す */
  tick: (count?: number) => Positions;
  positions: () => Positions;
  /** 0 に近づくほど収束している */
  alpha: () => number;
  /** 特定ノードを固定 / 解放（ドラッグ用） */
  pin: (id: string, x: number | null, y: number | null) => void;
  stop: () => void;
}

export function nodeRadius(degree: number): number {
  return 3.5 + Math.min(9, Math.sqrt(degree) * 2.2);
}

/**
 * 力学レイアウト。
 *
 * 反発力 (forceManyBody) は d3 が四分木による Barnes-Hut 近似を使うので、
 * ノード数が増えても O(n log n) で済む（設計書 §10）。
 * d3 の内部タイマーは止めて、こちらから明示的に tick を回す。
 * こうすると Worker の中でも、テストの中でも、同じコードがそのまま動く。
 */
export function createLayout(data: GraphData, options: LayoutOptions): LayoutEngine {
  const { width, height, linkDistance = 42, charge = -140 } = options;

  const nodes: SimNode[] = data.nodes.map((n) => ({
    id: n.id,
    radius: nodeRadius(n.degree),
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links: SimLink[] = data.links
    .filter((l) => byId.has(l.source) && byId.has(l.target))
    .map((l) => ({ source: l.source, target: l.target }));

  const simulation: Simulation<SimNode, SimLink> = forceSimulation<SimNode, SimLink>(nodes)
    .force(
      'link',
      forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .distance(linkDistance)
        .strength(0.4),
    )
    .force('charge', forceManyBody<SimNode>().strength(charge).distanceMax(600))
    .force('center', forceCenter(width / 2, height / 2))
    .force('collide', forceCollide<SimNode>().radius((d) => d.radius + 3))
    .alphaDecay(0.025)
    .stop();

  const ids = nodes.map((n) => n.id);
  const xs = new Float32Array(nodes.length);
  const ys = new Float32Array(nodes.length);

  const snapshot = (): Positions => {
    for (let i = 0; i < nodes.length; i++) {
      xs[i] = nodes[i]!.x ?? 0;
      ys[i] = nodes[i]!.y ?? 0;
    }
    return { ids, xs, ys };
  };

  return {
    tick(count = 1) {
      simulation.tick(count);
      return snapshot();
    },
    positions: snapshot,
    alpha: () => simulation.alpha(),
    pin(id, x, y) {
      const node = byId.get(id);
      if (!node) return;
      node.fx = x ?? undefined;
      node.fy = y ?? undefined;
      if (x !== null) simulation.alpha(0.3);
    },
    stop() {
      simulation.stop();
    },
  };
}

/** 一気に収束させて座標だけ欲しいとき（Worker が使えない環境やテスト用） */
export function computeLayout(
  data: GraphData,
  options: LayoutOptions,
  iterations = 220,
): Positions {
  const engine = createLayout(data, options);
  const result = engine.tick(iterations);
  engine.stop();
  return result;
}
