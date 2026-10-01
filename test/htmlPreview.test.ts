// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  clearHtmlPreview,
  createHtmlPreviewFrame,
  createHtmlPreviewUrl,
  createHtmlPreviewUrlWithImages,
  createHtmlPreviewResourceWithImages,
  isAllowedPreviewUrl,
  renderHtmlPreview,
  sanitizeHtmlPreview,
} from '../src/ui/htmlPreview';

describe('HTML preview security', () => {
  it('Blob文書でもサニタイズ・見出し位置を保ち、URLを一度だけ解放する', async () => {
    let captured!: Blob;
    const revoke = vi.fn();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((blob: Blob) => { captured = blob; return 'blob:preview/1'; }),
      revokeObjectURL: revoke,
    });
    try {
      const resource = await createHtmlPreviewResourceWithImages('<h1>Safe</h1><script>bad()</script><img src="https://example.com/a.png" onerror="bad()">', async () => null, { headingIndex: 0 });
      expect(resource.url).toBe('blob:preview/1#shiorbit-h0');
      expect(captured.type).toBe('text/html');
      const html = await new Promise<string>(resolve => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.readAsText(captured);
      });
      expect(html).toContain('<h1 id="shiorbit-h0">Safe</h1>');
      expect(html).not.toMatch(/<script|onerror|bad\(\)/);
      resource.dispose(); resource.dispose();
      expect(revoke).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });
  it.each(['png', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'WEBP'])('img.srcのBase64画像（%s）を保持し、イベント属性は除去する', (mime) => {
    const src = `data:image/${mime};base64,AQIDBA==`;
    const doc = new DOMParser().parseFromString(sanitizeHtmlPreview(`<img src="${src}" onerror="bad()">`), 'text/html');
    expect(doc.querySelector('img')?.getAttribute('src')).toBe(src);
    expect(doc.querySelector('img')?.hasAttribute('onerror')).toBe(false);
    expect(isAllowedPreviewUrl(src)).toBe(false); // 通常のURL許可リストは緩めない。
  });

  it.each([
    'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,PHNjcmlwdD4=',
    'data:application/javascript;base64,YWxlcnQoMSk=', 'data:image/png,abc',
    'data:image/png;charset=utf-8;base64,AQID', 'data:image/png;base64,',
    'data:image/png;base64,%%%=', 'data:image/png;base64,AQ==ID',
    'data:image/png;base64,AQIDB', 'data:image/png;base64,AQ\nID',
  ])('危険または不正な埋め込みURLを拒否する: %s', (src) => {
    const doc = new DOMParser().parseFromString(sanitizeHtmlPreview(`<img src="${src}">`), 'text/html');
    expect(doc.querySelector('img')?.hasAttribute('src')).toBe(false);
  });

  it('画像例外をリンク・フォーム・SVG・その他の要素へ広げない', () => {
    const src = 'data:image/png;base64,AQID';
    const html = sanitizeHtmlPreview(`<a href="${src}">Link</a><form action="${src}"><input src="${src}" formaction="${src}"></form><video poster="${src}"></video><svg><image href="${src}" xlink:href="${src}"/></svg>`);
    expect(html).not.toContain('data:image');
  });

  it('大きな埋め込みWebPを非同期プレビューでも保持し、Vaultのファイルとして読まない', async () => {
    const src = `data:image/webp;base64,${'AQID'.repeat(310000)}`;
    const seen: string[] = [];
    const url = await createHtmlPreviewUrlWithImages(`<img src="${src}"><img src="local.png">`, async path => {
      seen.push(path);
      return 'blob:resolved';
    });
    const doc = new DOMParser().parseFromString(decodeURIComponent(url.slice(url.indexOf(',') + 1)), 'text/html');
    expect(doc.querySelector('img')?.getAttribute('src')).toBe(src);
    expect(seen).toEqual(['local.png']);
  });

  it('CSSと本文を残し、スクリプト・イベント属性・危険なURLを除去する', () => {
    const output = sanitizeHtmlPreview(`<!doctype html>
      <html><head><style>body { color: red; }</style><script>window.pwned = true</script></head>
      <body onload="alert(1)">
        <h1 onclick="alert(2)">Title</h1>
        <a href="javascript:alert(3)">bad</a><a href="file:///secret">file</a>
        <img src="photo.png" onerror="alert(4)">
        <iframe src="https://example.com"></iframe>
      </body></html>`);

    expect(output).toContain('body { color: red; }');
    // 見出しには位置合わせ用の id が付く（本文はそのまま）。
    expect(output).toContain('<h1 id="shiorbit-h0">Title</h1>');
    expect(output).toContain('src="photo.png"');
    expect(output).not.toMatch(/<script|<iframe|onload|onclick|onerror|javascript:|file:\/\/\//i);
  });

  it('URL属性は http・https・mailto・相対参照だけを許可する', () => {
    for (const allowed of ['https://example.com', 'http://example.com', 'mailto:a@example.com', 'images/a.png', '../a.html', '#part']) {
      expect(isAllowedPreviewUrl(allowed), allowed).toBe(true);
    }
    for (const blocked of ['javascript:alert(1)', 'vbscript:x', 'data:text/html,x', 'data:image/png,x', 'file:///tmp/a', 'ftp://example.com', 'java\nscript:alert(1)']) {
      expect(isAllowedPreviewUrl(blocked), blocked).toBe(false);
    }
  });

  it('相対画像を解決済みURLへ差し替え、外部画像はそのまま残す', async () => {
    const seen: string[] = [];
    const url = await createHtmlPreviewUrlWithImages(
      '<h1>画像</h1><img src="images/a.png"><img src="https://example.com/b.png">',
      async (src) => {
        seen.push(src);
        return 'blob:shiorbit/a';
      },
    );
    const decoded = decodeURIComponent(url.slice(url.indexOf(',') + 1));
    expect(seen).toEqual(['images/a.png']);
    expect(decoded).toContain('src="blob:shiorbit/a"');
    expect(decoded).toContain('src="https://example.com/b.png"');
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
    expect(decoded).toContain('<h1 id="shiorbit-h0">Preview</h1>');
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
