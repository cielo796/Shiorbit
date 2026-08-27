import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * CSP は「壊れても画面が出てしまう」種類の設定なので、
 * 必要な許可が消えていないかをここで固定する（設計書 §11）。
 */
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const content = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html)?.[1] ?? '';

function directive(name: string): string {
  const found = content.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name} `));
  return found ?? '';
}

describe('Content-Security-Policy', () => {
  it('index.html に meta として入っている', () => {
    expect(content).not.toBe('');
    expect(directive('default-src')).toBe("default-src 'self'");
  });

  it('本番ではインラインスクリプトを許さない', () => {
    expect(directive('script-src')).toBe("script-src 'self'");
    expect(directive('object-src')).toBe("object-src 'none'");
    expect(directive('base-uri')).toBe("base-uri 'self'");
    expect(directive('form-action')).toBe("form-action 'none'");
  });

  it('アプリが実際に使う経路は許す', () => {
    // 埋め込み画像は ObjectURL、アイコンは data: URL。
    expect(directive('img-src')).toContain('blob:');
    expect(directive('img-src')).toContain('data:');
    // 利用者が HTML に書いた外部画像（設計書 §11 の例外）。
    // プレビューは data: URL なので親の CSP を継承する。ここを閉じると画像が全部消える。
    expect(directive('img-src')).toContain('https:');
    // HTML プレビューは data: URL の sandbox iframe。
    expect(directive('frame-src')).toContain('data:');
    // グラフの力学計算は Worker。
    expect(directive('worker-src')).toContain("'self'");
    // CodeMirror は <style> を差し込む。
    expect(directive('style-src')).toContain("'unsafe-inline'");
  });

  it('外部への送信口を開けていない', () => {
    // 画像は取りに行けるが、スクリプトと通信は閉じたまま。
    // XSS を踏んでも、外部へデータを送る手段は残らない。
    expect(directive('connect-src')).not.toContain('https:');
    expect(directive('connect-src')).not.toContain('*');
    expect(directive('default-src')).not.toContain('*');
    expect(directive('script-src')).not.toContain('https:');
  });
});
