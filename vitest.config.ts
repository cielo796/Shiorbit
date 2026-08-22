import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // ブラウザを一切使わずに実行する。これが「境界が正しい」ことの証明になる（設計書 §13.5）
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
