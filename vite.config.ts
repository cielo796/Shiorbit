import { defineConfig, type Plugin } from 'vite';

/**
 * 開発サーバは HMR のためにインラインスクリプトと WebSocket を使う。
 * 本番の CSP をそのまま当てると起動しないので、dev のときだけ緩める。
 * 本番用の内容は index.html に直接書いてあり、この置換が走らなくても有効。
 */
const DEV_CSP = [
  "default-src 'self'",
  "img-src 'self' blob: data: https:",
  "media-src 'self' blob: data: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "worker-src 'self' blob:",
  'frame-src blob: data:',
  "connect-src 'self' blob: data: ws: wss:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function relaxCspForDev(): Plugin {
  return {
    name: 'shiorbit-dev-csp',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (!ctx.server) return html;
        return html.replace(
          /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")[^"]*(")/,
          `$1${DEV_CSP}$2`,
        );
      },
    },
  };
}

export default defineConfig({
  // Electron は file:// でページを読み込むため、絶対パス (/assets/...) だと
  // ディスクのルートを探しに行って何も読み込めない。相対パスにしておく。
  // Web で配信する場合もルート直下なら問題なく動く。
  base: './',
  plugins: [relaxCspForDev()],
  server: { port: 5173, open: true },
  build: { target: 'es2022', outDir: 'dist' },
});
