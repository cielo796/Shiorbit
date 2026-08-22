import { computeLayout } from '../../core/graph/layout';
import type { GraphData } from '../../core/graph/types';

export interface TickPayload {
  xs: Float32Array;
  ys: Float32Array;
  alpha: number;
}

export interface LayoutSession {
  /** 計算が進むたびに呼ばれる */
  onTick: (cb: (payload: TickPayload) => void) => void;
  /** ノードの並び順（xs / ys の添字に対応） */
  onIds: (cb: (ids: string[]) => void) => void;
  pin: (id: string, x: number | null, y: number | null) => void;
  stop: () => void;
}

/**
 * レイアウト計算を開始する。
 *
 * Worker が使える環境ではそちらへ丸ごと逃がし、メインスレッドは描画だけにする。
 * 使えない環境（古いブラウザ、テストの jsdom など）では、
 * 一度だけまとめて計算して静止したグラフを描く。動きは無くなるが、内容は同じ。
 */
export function startLayout(data: GraphData, width: number, height: number): LayoutSession {
  const worker = createWorker();
  return worker
    ? workerSession(worker, data, width, height)
    : mainThreadSession(data, width, height);
}

function createWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('./graph.worker.ts', import.meta.url), { type: 'module' });
  } catch (e) {
    console.warn('[graph] Worker を起動できなかったのでメインスレッドで計算します', e);
    return null;
  }
}

function workerSession(worker: Worker, data: GraphData, width: number, height: number): LayoutSession {
  let tickCb: ((p: TickPayload) => void) | null = null;
  let idsCb: ((ids: string[]) => void) | null = null;

  worker.addEventListener('message', (ev: MessageEvent) => {
    const message = ev.data as
      | { type: 'ids'; ids: string[] }
      | ({ type: 'tick' } & TickPayload)
      | { type: 'settled' };

    if (message.type === 'ids') idsCb?.(message.ids);
    else if (message.type === 'tick') tickCb?.(message);
  });

  worker.postMessage({ type: 'start', data, width, height });

  return {
    onTick: (cb) => {
      tickCb = cb;
    },
    onIds: (cb) => {
      idsCb = cb;
    },
    pin: (id, x, y) => worker.postMessage({ type: 'pin', id, x, y }),
    stop: () => {
      worker.postMessage({ type: 'stop' });
      worker.terminate();
    },
  };
}

function mainThreadSession(data: GraphData, width: number, height: number): LayoutSession {
  let stopped = false;
  let tickCb: ((p: TickPayload) => void) | null = null;
  let idsCb: ((ids: string[]) => void) | null = null;

  const emit = (): void => {
    if (stopped) return;
    const positions = computeLayout(data, { width, height }, data.nodes.length > 400 ? 120 : 220);
    idsCb?.(positions.ids);
    tickCb?.({ xs: positions.xs, ys: positions.ys, alpha: 0 });
  };

  // 呼び出し側が onTick を登録するまで待つ
  const scheduled = setTimeout(emit, 0);

  return {
    onTick: (cb) => {
      tickCb = cb;
    },
    onIds: (cb) => {
      idsCb = cb;
    },
    pin: () => undefined,
    stop: () => {
      stopped = true;
      clearTimeout(scheduled);
    },
  };
}
