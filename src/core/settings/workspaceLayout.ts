import type { VPath } from '../vault/types';

/**
 * 開いていたタブと分割の形。Vault の中に置くので、
 * 端末を変えても同じ形で開き直せる（設定と同じ考え方）。
 */
export interface StoredPane {
  tabs: VPath[];
  active: VPath | null;
}

export interface StoredLayout {
  panes: StoredPane[];
  activePane: number;
  /** 左サイドバー（ファイル・検索など）を出しているか */
  sidebarShown: boolean;
  /** 右サイドバー（アウトライン・グラフ・リンク）を出しているか */
  rightbarShown: boolean;
  /** 古い構成では未指定（260px）。 */
  sidebarWidth?: number;
  /** 未指定は全フォルダを閉じる。 */
  expandedFolders?: VPath[];
}

export function normalizeSidebarWidth(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(200, Math.min(600, Math.round(value))) : 260;
}

export const LAYOUT_PATH = '.shiorbit/workspace.json';

/** 上限。壊れたファイルや古い形式で無限に開かないようにする。 */
const MAX_PANES = 2;
const MAX_TABS = 40;

export const EMPTY_LAYOUT: StoredLayout = {
  panes: [{ tabs: [], active: null }],
  activePane: 0,
  sidebarShown: true,
  rightbarShown: true,
};

/** 何が入っていても、開ける形に整えて返す。読めなければ空の構成。 */
export function normalizeLayout(input: unknown): StoredLayout {
  if (typeof input !== 'object' || input === null) return EMPTY_LAYOUT;
  const source = input as Record<string, unknown>;

  const panes = Array.isArray(source['panes'])
    ? source['panes'].slice(0, MAX_PANES).map(normalizePane).filter((pane) => pane !== null)
    : [];
  if (panes.length === 0) return EMPTY_LAYOUT;

  const active = typeof source['activePane'] === 'number' ? source['activePane'] : 0;
  return {
    panes: panes as StoredPane[],
    activePane: Math.max(0, Math.min(panes.length - 1, Math.trunc(active))),
    // 書かれていなければ「出す」。畳んだ覚えがないのに消えているほうが困る。
    sidebarShown: source['sidebarShown'] !== false,
    rightbarShown: source['rightbarShown'] !== false,
    ...(source['sidebarWidth'] === undefined ? {} : { sidebarWidth: normalizeSidebarWidth(source['sidebarWidth']) }),
    ...(source['expandedFolders'] === undefined ? {} : { expandedFolders: normalizeFolders(source['expandedFolders']) }),
  };
}

function normalizeFolders(input: unknown): VPath[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((path): path is string => typeof path === 'string'
    && path.length > 0 && path.length <= 4096 && !/[\\:\u0000-\u001f]/.test(path)
    && path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..')))].slice(0, 10000);
}

function normalizePane(input: unknown): StoredPane | null {
  if (typeof input !== 'object' || input === null) return null;
  const source = input as Record<string, unknown>;

  const tabs = Array.isArray(source['tabs'])
    ? [...new Set(source['tabs'].filter((tab): tab is string => typeof tab === 'string' && tab !== ''))]
      .slice(0, MAX_TABS)
    : [];

  const raw = source['active'];
  const active = typeof raw === 'string' && tabs.includes(raw) ? raw : (tabs[0] ?? null);
  return { tabs, active };
}

export function serializeLayout(layout: StoredLayout): string {
  return `${JSON.stringify(normalizeLayout(layout), null, 2)}\n`;
}

export function parseLayout(text: string): StoredLayout {
  try {
    return normalizeLayout(JSON.parse(text));
  } catch {
    return EMPTY_LAYOUT;
  }
}

/**
 * 何も覚えていない構成かどうか。
 * タブが無くても、畳んだ状態は復元する値がある。
 */
export function isEmptyLayout(layout: StoredLayout): boolean {
  return layout.panes.every((pane) => pane.tabs.length === 0)
    && layout.sidebarShown
    && layout.rightbarShown
    && normalizeSidebarWidth(layout.sidebarWidth) === 260
    && (layout.expandedFolders?.length ?? 0) === 0;
}
