import { describe, expect, it } from 'vitest';
import {
  EMPTY_LAYOUT,
  isEmptyLayout,
  normalizeLayout,
  parseLayout,
  serializeLayout,
} from '../src/core/settings/workspaceLayout';

describe('ワークスペース構成の保存', () => {
  it('展開フォルダを保存・復元し、旧設定では全て閉じる', () => {
    const stored = { ...EMPTY_LAYOUT, expandedFolders: ['料理', '学習/Next.js'] };
    expect(parseLayout(serializeLayout(stored))).toEqual(stored);
    expect(isEmptyLayout(stored)).toBe(false);
    expect(normalizeLayout({ ...EMPTY_LAYOUT, expandedFolders: ['A', 'A', '', null, '../outside'] }).expandedFolders).toEqual(['A']);
    expect(normalizeLayout(EMPTY_LAYOUT).expandedFolders ?? []).toEqual([]);
  });
  const layout = {
    panes: [
      { tabs: ['a.md', 'b.md'], active: 'b.md' },
      { tabs: ['c.md'], active: 'c.md' },
    ],
    activePane: 1,
    sidebarShown: false,
    rightbarShown: true,
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
      sidebarShown: true,
      rightbarShown: true,
    });
  });

  it('選択が一覧に無ければ先頭にする', () => {
    expect(normalizeLayout({ panes: [{ tabs: ['a.md'], active: 'いない.md' }], activePane: 0 }))
      .toEqual({
        panes: [{ tabs: ['a.md'], active: 'a.md' }],
        activePane: 0,
        sidebarShown: true,
        rightbarShown: true,
      });
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
    // タブが無くても、畳んだ状態は覚える価値がある。
    expect(isEmptyLayout({ ...EMPTY_LAYOUT, sidebarShown: false })).toBe(false);
  });

  it('左右パネルの表示を覚える（書かれていなければ出す）', () => {
    expect(parseLayout(serializeLayout(layout)).sidebarShown).toBe(false);
    expect(parseLayout(serializeLayout(layout)).rightbarShown).toBe(true);

    // 古い workspace.json には無い項目。消えていたと勘違いさせないよう既定は表示。
    const old = normalizeLayout({ panes: [{ tabs: ['a.md'], active: 'a.md' }], activePane: 0 });
    expect(old.sidebarShown).toBe(true);
    expect(old.rightbarShown).toBe(true);
  });
});
