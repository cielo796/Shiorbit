/**
 * 力学計算をメインスレッドから追い出すための Worker (設計書 §10)。
 *
 * ここでは座標を計算するだけで、描画は一切しない。
 * メインスレッドは受け取った座標を Canvas に描くことに専念できる。
 */
import { createLayout, type LayoutEngine } from '../../core/graph/layout';
import type { GraphData } from '../../core/graph/types';

type Incoming =
  | { type: 'start'; data: GraphData; width: number; height: number }
  | { type: 'pin'; id: string; x: number | null; y: number | null }
  | { type: 'stop' };

interface WorkerScope {
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
  addEventListener: (type: 'message', cb: (ev: MessageEvent<Incoming>) => void) => void;
}

const ctx = self as unknown as WorkerScope;

const TICK_MS = 16;
const REST_ALPHA = 0.008;

let engine: LayoutEngine | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function halt(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
  engine?.stop();
  engine = null;
}

function step(): void {
  if (!engine) return;
  const positions = engine.tick(1);
  const alpha = engine.alpha();

  // 転送するとバッファが切り離されるので、複製を送る
  const xs = positions.xs.slice();
  const ys = positions.ys.slice();
  ctx.postMessage({ type: 'tick', xs, ys, alpha }, [xs.buffer, ys.buffer]);

  if (alpha < REST_ALPHA) {
    if (timer !== null) clearInterval(timer);
    timer = null;
    ctx.postMessage({ type: 'settled' });
  }
}

ctx.addEventListener('message', (ev) => {
  const message = ev.data;

  if (message.type === 'start') {
    halt();
    engine = createLayout(message.data, { width: message.width, height: message.height });
    ctx.postMessage({ type: 'ids', ids: engine.positions().ids });
    timer = setInterval(step, TICK_MS);
    return;
  }

  if (message.type === 'pin') {
    engine?.pin(message.id, message.x, message.y);
    if (engine && timer === null) timer = setInterval(step, TICK_MS);
    return;
  }

  if (message.type === 'stop') halt();
});
