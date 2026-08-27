import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * レイアウトの「戻すと壊れる1行」を固定する。
 *
 * テストは jsdom で走り、レイアウト計算をしない。だから見た目は検査できない。
 * ここで守るのは、**実機で壊れた原因そのものを CSS から消させない**ことだけ。
 * 理由は style.css のコメントに書いてある。
 */
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

/** 行頭から始まる規則だけを拾う（`.a > .b {` の中に紛れ込ませない）。 */
function block(selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
}

describe('画面が伸びきらないための決まり', () => {
  it('ワークスペースの行の下限は 0（1fr のままだと中身に押し広げられる）', () => {
    // 1fr = minmax(auto, 1fr)。auto の最小は「中身の最小サイズ」なので、
    // 長い HTML プレビューを開くと行が数万 px になり、どこもスクロールしなくなる。
    expect(block('.workspace')).toContain('grid-template-rows: minmax(0, 1fr)');
    expect(block('.workspace')).not.toMatch(/grid-template-rows:\s*1fr/);
  });

  it('body は画面に固定する（伸びた分は中の要素がスクロールする）', () => {
    expect(block('body')).toContain('overflow: hidden');
  });

  it('高さを渡す入れ物には min-height: 0 を置く', () => {
    // flex/grid の既定の最小サイズは中身。これが無いと同じ形で伸びる。
    for (const selector of ['.document-panes', '.document-pane', '.editor-host']) {
      expect(block(selector), selector).toContain('min-height: 0');
    }
  });

  it('プレビューは入れ物いっぱいに置く（中身の高さで伸ばさない）', () => {
    expect(block('.html-preview')).toContain('height: 100%');
  });
});
