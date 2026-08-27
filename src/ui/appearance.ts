import type { SettingsData } from '../core/settings/Settings';

/**
 * 見た目の設定を画面へ流し込む。
 *
 * 文字サイズは CSS 変数に書く。個別のセレクタを触らずに全体へ効かせるためで、
 * Electron の webFrame ズームは使わない（二重に掛かると座標がずれる）。
 */
export function applyAppearance(data: SettingsData): void {
  const root = document.documentElement;
  root.dataset['theme'] = data.theme;
  root.style.setProperty('--ui-font-size', `${round(data.uiFontSize * data.zoom)}px`);
  root.style.setProperty('--editor-font-size', `${round(data.editorFontSize * data.zoom)}px`);
}

/** CSS 変数へ書く値。端数が積み上がって滲まないよう 0.1px で丸める。 */
function round(px: number): number {
  return Math.round(px * 10) / 10;
}
