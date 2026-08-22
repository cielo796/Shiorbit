import { defineConfig } from 'vite';

export default defineConfig({
  // Electron は file:// でページを読み込むため、絶対パス (/assets/...) だと
  // ディスクのルートを探しに行って何も読み込めない。相対パスにしておく。
  // Web で配信する場合もルート直下なら問題なく動く。
  base: './',
  server: { port: 5173, open: true },
  build: { target: 'es2022', outDir: 'dist' },
});
