import '../../src/style.css';
import { App } from '../../src/ui/app';
import { MemoryAdapter } from '../../src/adapters/memory';

// ブラウザ表示検証専用。ユーザーのフォルダ・設定・履歴には触らない。
const adapter = new MemoryAdapter('検索UI検証（メモリのみ）');
await adapter.write('.shiorbit/settings.json', JSON.stringify({ theme: 'light', livePreview: false }));
await adapter.write('修理記録.md', [
  '# PC修理の作業記録', '',
  '検索パネルの表示確認用ノートです。', '',
  '## 受付', '修理の受付時に型番と症状を確認します。',
  '## 診断', '修理に入る前にデータのバックアップを取ります。',
  '## 作業', '修理後は起動と動作を確認します。', '',
  ...Array.from({ length: 45 }, (_, i) => `${i + 1}. ${i % 3 === 0 ? '修理' : '点検'}の確認事項を記録します。`),
  '', '## 最終行', '本文の最下行も、検索パネルを開いたまま読めます。',
].join('\n'));
await adapter.write('点検メモ.md', '# 点検メモ\n修理に必要な部品を確認します。\n修理の日程を決めます。');
await adapter.write('案内.html', '<!doctype html>\n<html lang="ja"><body><h1>修理の案内</h1><p>修理受付はこちら</p></body></html>');
const root = document.getElementById('app')!;
await new App(root, {
  supported: false, unsupportedReason: '', restore: async () => adapter,
  hasSaved: async () => false, pick: async () => adapter, demo: async () => adapter,
}).start();
