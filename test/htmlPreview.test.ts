// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createHtmlPreviewFrame, sanitizeHtmlPreview } from '../src/ui/htmlPreview';

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
});
