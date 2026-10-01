import { afterEach, expect, it, vi } from 'vitest';
import { startLayout } from '../src/ui/graph/layoutSession';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('Workerがない場合も計算を分割し、途中で入力処理とキャンセルができる', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('Worker', undefined);
  const session = startLayout({ nodes: [{ id: 'a', label: 'A', degree: 0, kind: 'note' }], links: [] }, 300, 200);
  const ticks = vi.fn();
  const ids = vi.fn();
  session.onTick(ticks);
  session.onIds(ids);
  expect(ticks).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(0);
  expect(ids).toHaveBeenCalledWith(['a']);
  expect(ticks).toHaveBeenCalledOnce();
  expect(ticks.mock.calls[0]![0].alpha).toBeGreaterThan(0);
  const input = vi.fn();
  setTimeout(input, 1);
  await vi.advanceTimersByTimeAsync(1);
  expect(input).toHaveBeenCalledOnce();
  expect(ticks).toHaveBeenCalledOnce();
  session.stop();
  await vi.advanceTimersByTimeAsync(1000);
  expect(ticks).toHaveBeenCalledOnce();
});

it('分割計算も最後は収束した座標を返す', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('Worker', undefined);
  const session = startLayout({ nodes: [{ id: 'a', label: 'A', degree: 0, kind: 'note' }], links: [] }, 300, 200);
  const ticks = vi.fn();
  session.onTick(ticks);
  await vi.advanceTimersByTimeAsync(10000);
  expect(ticks.mock.lastCall![0].alpha).toBe(0);
  expect(Number.isFinite(ticks.mock.lastCall![0].xs[0])).toBe(true);
  session.stop();
});
