import { describe, expect, it } from 'vitest';
import {
  EMPTY_LAYOUT,
  isEmptyLayout,
  normalizeLayout,
  parseLayout,
  serializeLayout,
} from '../src/core/settings/workspaceLayout';

describe('ワークスペース構成の保存', () => {
  const layout = {
    panes: [
      { tabs: ['a.md', 'b.md'], active: 'b.md' },
      { tabs: ['c.md'], active: 'c.md' },
    ],
    activePane: 1,
  };

  it('書き戻して読み直しても同じ', () => {
    expect(parseLayout(serializeLayout(layout))).toEqual(layout);
  });

  it('壊れていても開ける形に整える', () => {
    expect(parseLayout('{ これは JSON ではない')).toEqual(EMPTY_LAYOUT);
    expect(normalizeLayout(null)).toEqual(EMPTY_LAYOUT);
    expect(normalizeLayout({ panes: [] })).toEqual(EMPTY_LAYOUT);
    expect(normalizeLayout({ panes: [{ tabs: 'not-an-array' }] })).toEqual({
      panes: [{ tabs: [], active: null }],
      activePane: 0,
    });
  });

  it('選択が一覧に無ければ先頭にする', () => {
    expect(normalizeLayout({ panes: [{ tabs: ['a.md'], active: 'いない.md' }], activePane: 0 }))
      .toEqual({ panes: [{ tabs: ['a.md'], active: 'a.md' }], activePane: 0 });
  });

  it('重複したタブは1つにまとめる', () => {
    expect(normalizeLayout({ panes: [{ tabs: ['a.md', 'a.md', 'b.md'], active: 'a.md' }] }).panes[0]?.tabs)
      .toEqual(['a.md', 'b.md']);
  });

  it('ペインは2つまで、タブは40枚まで', () => {
    const many = normalizeLayout({
      panes: [{ tabs: [], active: null }, { tabs: [], active: null }, { tabs: [], active: null }],
      activePane: 9,
    });
    expect(many.panes).toHaveLength(2);
    expect(many.activePane).toBe(1);

    const tabs = Array.from({ length: 60 }, (_, i) => `n${i}.md`);
    expect(normalizeLayout({ panes: [{ tabs, active: 'n0.md' }] }).panes[0]?.tabs).toHaveLength(40);
  });

  it('何も開いていない構成が分かる', () => {
    expect(isEmptyLayout(EMPTY_LAYOUT)).toBe(true);
    expect(isEmptyLayout(layout)).toBe(false);
  });
});
