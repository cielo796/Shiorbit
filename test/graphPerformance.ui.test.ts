// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GraphData } from '../src/core/graph/types';
import { GraphView } from '../src/ui/graph/GraphView';
import { startLayout } from '../src/ui/graph/layoutSession';

vi.mock('../src/ui/graph/layoutSession', () => ({ startLayout: vi.fn(() => ({
  onIds: vi.fn(), onTick: vi.fn(), pin: vi.fn(), stop: vi.fn(),
})) }));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

const data: GraphData = { nodes: [{ id: 'a', label: 'A', kind: 'note', degree: 0 }], links: [] };

describe('グラフの不要な計算抑制', () => {
  it('非表示では計算せず、表示された時に開始し、同じ索引通知では起動し直さない', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
    const view = new GraphView({ onSelect: vi.fn() });
    const rect = vi.spyOn(view.dom, 'getBoundingClientRect').mockReturnValue({ width: 0, height: 0 } as DOMRect);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    view.setData(data);
    expect(view.nodeCount).toBe(1);
    expect(startLayout).not.toHaveBeenCalled();
    rect.mockReturnValue({ width: 300, height: 200 } as DOMRect);
    view.resize();
    expect(startLayout).toHaveBeenCalledOnce();
    view.setData({ nodes: data.nodes.map(n => ({ ...n })), links: [] });
    expect(startLayout).toHaveBeenCalledOnce();
    const session = vi.mocked(startLayout).mock.results[0]!.value;
    rect.mockReturnValue({ width: 0, height: 0 } as DOMRect);
    view.resize();
    expect(session.stop).toHaveBeenCalledOnce();
    rect.mockReturnValue({ width: 300, height: 200 } as DOMRect);
    view.resize();
    expect(startLayout).toHaveBeenCalledTimes(2);
    view.destroy();
    vi.unstubAllGlobals();
  });

  it('リンク・ラベルが変わったら再計算する', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    const view = new GraphView({ onSelect: vi.fn() });
    vi.spyOn(view.dom, 'getBoundingClientRect').mockReturnValue({ width: 300, height: 200 } as DOMRect);
    view.setData(data);
    view.setData({ nodes: [{ ...data.nodes[0]!, label: 'Renamed' }], links: [] });
    expect(startLayout).toHaveBeenCalledTimes(2);
    view.destroy();
    vi.unstubAllGlobals();
  });
});
