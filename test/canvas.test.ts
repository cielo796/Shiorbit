import { describe, expect, it } from 'vitest';
import { isCanvasReadable, newCanvasId, parseCanvas, stringifyCanvas } from '../src/core/canvas/parse';
import { emptyCanvas } from '../src/core/canvas/types';

/** Obsidian が書き出す形。座標が合っていることを確かめるための実物に近い例。 */
const OBSIDIAN = JSON.stringify({
  nodes: [
    { id: 'a1', type: 'text', x: -120, y: -40, width: 260, height: 120, text: '# 構想' },
    {
      id: 'a2',
      type: 'file',
      file: 'AI/Ollama.md',
      x: 320,
      y: 0,
      width: 300,
      height: 200,
      color: '4',
    },
  ],
  edges: [{ id: 'e1', fromNode: 'a1', fromSide: 'right', toNode: 'a2', toSide: 'left' }],
});

describe('.canvas の読み込み', () => {
  it('Obsidian の JSON をそのまま読む（座標も色も保つ）', () => {
    const data = parseCanvas(OBSIDIAN);
    expect(data.nodes).toHaveLength(2);
    expect(data.nodes[0]).toMatchObject({ id: 'a1', type: 'text', x: -120, y: -40, text: '# 構想' });
    expect(data.nodes[1]).toMatchObject({ type: 'file', file: 'AI/Ollama.md', x: 320, color: '4' });
    expect(data.edges[0]).toMatchObject({ fromNode: 'a1', fromSide: 'right', toSide: 'left' });
  });

  it('往復しても意味が変わらない', () => {
    const once = parseCanvas(OBSIDIAN);
    expect(parseCanvas(stringifyCanvas(once))).toEqual(once);
  });

  it('知らないキーを落とさずに書き戻す', () => {
    const source = JSON.stringify({
      version: '1.0',
      nodes: [{ id: 'x', type: 'text', x: 0, y: 0, width: 10, height: 10, text: '', styleAttributes: { a: 1 } }],
      edges: [],
    });
    const written = JSON.parse(stringifyCanvas(parseCanvas(source))) as Record<string, unknown>;
    expect(written['version']).toBe('1.0');
    expect((written['nodes'] as Record<string, unknown>[])[0]!['styleAttributes']).toEqual({ a: 1 });
  });

  it('壊れた JSON でも落ちず、空として扱う', () => {
    expect(parseCanvas('{ これは JSON ではない')).toEqual(emptyCanvas());
    expect(parseCanvas('[1,2,3]')).toEqual(emptyCanvas());
    expect(parseCanvas('')).toEqual(emptyCanvas());
  });

  it('読めたかどうかを別に判定できる（空で上書きしないため）', () => {
    expect(isCanvasReadable('')).toBe(true);
    expect(isCanvasReadable('{"nodes":[]}')).toBe(true);
    expect(isCanvasReadable('{ 壊れている')).toBe(false);
  });

  it('id の無いノード・知らない種別・端の無い辺は捨てる', () => {
    const data = parseCanvas(JSON.stringify({
      nodes: [
        { type: 'text', x: 0, y: 0 },
        { id: 'ok', type: 'text', x: 0, y: 0, width: 10, height: 10 },
        { id: 'bad', type: 'hologram', x: 0, y: 0 },
      ],
      edges: [
        { id: 'e1', fromNode: 'ok', toNode: 'missing' },
        { id: 'e2', fromNode: 'ok', toNode: 'ok' },
      ],
    }));
    expect(data.nodes.map((node) => node.id)).toEqual(['ok']);
    expect(data.edges.map((edge) => edge.id)).toEqual(['e2']);
  });

  it('欠けた寸法は既定値で埋める', () => {
    const node = parseCanvas('{"nodes":[{"id":"a","type":"text"}],"edges":[]}').nodes[0]!;
    expect(node).toMatchObject({ x: 0, y: 0, width: 260, height: 120, text: '' });
  });

  it('辺の向きが不正なら既定の向きにする', () => {
    const edge = parseCanvas(JSON.stringify({
      nodes: [{ id: 'a', type: 'text' }, { id: 'b', type: 'text' }],
      edges: [{ id: 'e', fromNode: 'a', toNode: 'b', fromSide: '斜め' }],
    })).edges[0]!;
    expect(edge.fromSide).toBe('right');
    expect(edge.toSide).toBe('left');
  });

  it('新しい id は既存とぶつからない', () => {
    const taken = new Set(['a', 'b']);
    const id = newCanvasId(taken);
    expect(taken.has(id)).toBe(false);
    expect(id).toHaveLength(16);
  });
});
