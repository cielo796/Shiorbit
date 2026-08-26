// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  clearHtmlPreview,
  createHtmlPreviewFrame,
  createHtmlPreviewUrl,
  renderHtmlPreview,
  sanitizeHtmlPreview,
} from '../src/ui/htmlPreview';

describe('HTML preview security', () => {
  it('CSSと本文を残し、スクリプト・イベント属性・危険なURLを除去する', () => {
    const output = sanitizeHtmlPreview(`<!doctype html>
      <html><head><style>body { color: red; }</style><script>window.pwned = true</script></head>
      <body onload="alert(1)">
        <h1 onclick="alert(2)">Title</h1>
        <a href="javascript:alert(3)">bad</a>
        <img src="photo.png" onerror="alert(4)">
        <iframe src="https://example.com"></iframe>
      </body></html>`);

    expect(output).toContain('body { color: red; }');
    expect(output).toContain('<h1>Title</h1>');
    expect(output).toContain('src="photo.png"');
    expect(output).not.toMatch(/<script|<iframe|onload|onclick|onerror|javascript:/i);
  });

  it('JavaScript権限なしのsandbox iframeを作る', () => {
    const frame = createHtmlPreviewFrame();
    expect(frame.hasAttribute('sandbox')).toBe(true);
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.referrerPolicy).toBe('no-referrer');
  });

  it('サニタイズ済みHTMLをdata URLとして読み込み、確実に再描画する', () => {
    const source = '<style>body{color:red}</style><h1 onclick="alert(1)">Preview</h1><script>bad()</script>';
    const url = createHtmlPreviewUrl(source);
    const decoded = decodeURIComponent(url.slice(url.indexOf(',') + 1));
    expect(url).toMatch(/^data:text\/html;charset=utf-8,/);
    expect(decoded).toContain('body{color:red}');
    expect(decoded).toContain('<h1>Preview</h1>');
    expect(decoded).not.toMatch(/<script|onclick/i);

    const frame = createHtmlPreviewFrame();
    renderHtmlPreview(frame, source);
    expect(frame.src).toBe(url);
    expect(frame.hasAttribute('srcdoc')).toBe(false);
    clearHtmlPreview(frame);
    expect(frame.hasAttribute('src')).toBe(false);
    expect(frame.srcdoc).toBe('');
  });
});

describe('HTML プレビューの拡大', () => {
  it('等倍なら何も差し込まない', () => {
    const html = sanitizeHtmlPreview('<p>本文</p>', { zoom: 1 });
    expect(html).not.toContain('zoom');
  });

  it('倍率を文書のルートへ差し込む', () => {
    const html = sanitizeHtmlPreview('<p>本文</p>', { zoom: 1.5 });
    expect(html).toContain(':root { zoom: 1.5; }');
    expect(html).toContain('<p>本文</p>');
  });

  it('拡大しても危険な記述は残さない', () => {
    const html = sanitizeHtmlPreview('<script>alert(1)</script><p onclick="x()">本文</p>', { zoom: 1.5 });
    expect(html).not.toContain('alert(1)');
    expect(html).not.toContain('onclick');
    expect(html).toContain('zoom: 1.5');
  });
});
