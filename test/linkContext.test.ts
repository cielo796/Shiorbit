import { describe, expect, it } from 'vitest';
import { linkContext } from '../src/core/index/linkContext';
import { parseHtmlLinks } from '../src/core/index/scanDocument';
import { extractContext } from '../src/core/markdown/scan';
import { parseLinks } from '../src/core/markdown/wikilink';
import { limitContext, MAX_CONTEXT_LENGTH } from '../src/core/text/excerpt';

describe('巨大なリンク文脈を保持しない', () => {
  const htmlContext = (source: string) => {
    const ref = parseHtmlLinks('guide.html', source)[0]!;
    return { text: linkContext('guide.html', source, ref), ref };
  };

  it('通常のMarkdownの行とジャンプ位置は保つ', () => {
    const source = '一行目\n二行目に [[X]] がある\n三行目';
    const ref = parseLinks(source)[0]!;
    expect(linkContext('a.md', source, ref)).toBe('二行目に [[X]] がある');
    expect(source.slice(ref.from, ref.to)).toBe('[[X]]');
  });

  it('長いMarkdownの行でもリンク付近を160文字以内にする', () => {
    const source = `${'x'.repeat(1024 * 1024)} [[Target]] 日本語の文脈 ${'y'.repeat(1024 * 1024)}`;
    const ref = parseLinks(source)[0]!;
    const context = extractContext(source, ref.from, ref.to);
    expect(context.length).toBeLessThanOrEqual(MAX_CONTEXT_LENGTH);
    expect(context).toContain('[[Target]] 日本語の文脈');
  });

  it('HTMLはタグや属性でなくリンクラベルを表示する', () => {
    const result = htmlContext('<a class="internal" title="private" href="a.md"><b>日本語</b> &amp; 英語</a><p>別の段落</p>');
    expect(result.text).toBe('日本語 & 英語');
    expect(result.text).not.toMatch(/private|internal|href|段落/);
    expect(result.ref.raw).toBe('a.md');
  });

  it('属性中の > でタグの終端を間違えない', () => {
    expect(htmlContext('<a href="a.md" title="a > b">ラベル</a>').text).toBe('ラベル');
  });

  it('ラベル内のスクリプト・CSSは文脈から除く', () => {
    expect(htmlContext('<a href="a.md"><script>hidden()</script><style>secret{}</style>表示</a>').text).toBe('表示');
  });

  it('8MBのBase64画像を含む一行HTMLでも短い文脈だけを返す', () => {
    const source = `<a href="カイロ.html"><img src="data:image/png;base64,${'A'.repeat(8 * 1024 * 1024)}">説明</a>`;
    const { text, ref } = htmlContext(source);
    expect(text).toBe('カイロ');
    expect(text.length).toBeLessThanOrEqual(MAX_CONTEXT_LENGTH);
    expect(text).not.toMatch(/data:|base64|AAAA/);
    expect(source.slice(ref.from, ref.to)).toBe('カイロ.html');
  });

  it('リンクの前に巨大な画像があっても、その画像を文脈へ取り込まない', () => {
    const source = `<img src="data:image/png;base64,${'A'.repeat(1024 * 1024)}"><a href="a.md">攻略</a>`;
    expect(htmlContext(source).text).toBe('攻略');
  });

  it('相対画像の文脈にはaltを使い、空ならファイル名を使う', () => {
    expect(htmlContext('<img src="images/map.png" alt="地形 &amp; POI">').text).toBe('地形 & POI');
    expect(htmlContext('<img src="images/map.png">').text).toBe('map');
  });

  it('閉じない巨大タグやHTMLラベルでも終了し、上限を保つ', () => {
    expect(htmlContext(`<a href="a.md" title="${'x'.repeat(10000)}">表示</a>`).text).toBe('a');
    expect(htmlContext(`<a href="a.md">${'日本語 '.repeat(2000)}`).text.length).toBeLessThanOrEqual(MAX_CONTEXT_LENGTH);
  });

  it('表示上限でサロゲートペアを分断しない', () => {
    const shortened = limitContext(`${'x'.repeat(158)}😀末尾`);
    expect(shortened.length).toBeLessThanOrEqual(MAX_CONTEXT_LENGTH);
    expect(shortened).toBe(`${'x'.repeat(158)}…`);
  });
});
