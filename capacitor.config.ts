import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.shiorbit',
  appName: 'Shiorbit',
  // vite build の出力をそのままネイティブへ載せる
  webDir: 'dist',
  ios: {
    // ノッチ・ホームインジケータの領域は CSS の safe-area-inset で扱う
    contentInset: 'never',
  },
  android: {
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
