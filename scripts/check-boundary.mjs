#!/usr/bin/env node
/**
 * 設計書 §13.4 の「境界ルール」を機械的に検査する。
 *
 *   ルール1: プラットフォーム固有の識別子は src/adapters/ の外に出さない
 *   依存方向: src/core, src/ui は src/adapters を import しない
 *             (合成ルートである src/main.ts だけが例外)
 *
 * これが落ちたら、新しいプラットフォームへの対応コストが跳ね上がっている合図。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = 'src';
const ADAPTER_PREFIX = join(SRC, 'adapters') + sep;
const COMPOSITION_ROOT = join(SRC, 'main.ts');

/** src/adapters/ の外に出てはいけない識別子 */
const FORBIDDEN = [
  [/\bshowDirectoryPicker\b/, 'File System Access API (フォルダ選択)'],
  [/\bshowOpenFilePicker\b/, 'File System Access API (ファイル選択)'],
  [/\bshowSaveFilePicker\b/, 'File System Access API (保存ダイアログ)'],
  [/\bFileSystemDirectoryHandle\b/, 'ブラウザ固有のハンドル型'],
  [/\bFileSystemFileHandle\b/, 'ブラウザ固有のハンドル型'],
  [/\bFileSystemWritableFileStream\b/, 'ブラウザ固有のハンドル型'],
  [/\bcreateWritable\s*\(/, 'File System Access API (書き込み)'],
  [/\bnavigator\s*\.\s*storage\b/, 'OPFS / StorageManager'],
  [/\bindexedDB\b/, 'IndexedDB (永続化はアダプタの責務)'],
  [/\bCapacitor\b/, 'Capacitor'],
  [/@capacitor\//, 'Capacitor プラグイン'],
  [/\bfrom\s+['"]node:fs['"]/, 'Node.js fs'],
  [/\bfrom\s+['"]fs['"]/, 'Node.js fs'],
  [/\brequire\s*\(\s*['"]fs['"]\s*\)/, 'Node.js fs'],
  [/\bfrom\s+['"]electron['"]/, 'Electron'],
];

const IMPORT_ADAPTERS = /(?:from|import)\s*\(?\s*['"][^'"]*adapters\/[^'"]*['"]/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

const violations = [];

for (const file of walk(SRC)) {
  const rel = relative('.', file);
  const isAdapter = rel.startsWith(ADAPTER_PREFIX);
  const isRoot = rel === COMPOSITION_ROOT;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);

  lines.forEach((line, i) => {
    const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, ''); // コメント行は対象外
    if (code.trim() === '') return;

    if (!isAdapter) {
      for (const [re, why] of FORBIDDEN) {
        if (re.test(code)) {
          violations.push({
            file: rel,
            line: i + 1,
            rule: 'ルール1: プラットフォーム固有の識別子',
            detail: why,
            text: line.trim(),
          });
        }
      }
    }

    if (!isAdapter && !isRoot && IMPORT_ADAPTERS.test(code)) {
      violations.push({
        file: rel,
        line: i + 1,
        rule: '依存方向: core / ui は adapters を import しない',
        detail: 'アダプタを使ってよいのは合成ルート src/main.ts だけ',
        text: line.trim(),
      });
    }
  });
}

if (violations.length === 0) {
  console.log('境界チェック OK — プラットフォーム依存は src/adapters/ に閉じ込められています。');
  process.exit(0);
}

console.error(`境界チェック NG — ${violations.length} 件の違反があります (設計書 §13.4)\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}`);
  console.error(`    ${v.rule}`);
  console.error(`    → ${v.detail}`);
  console.error(`    ${v.text}\n`);
}
console.error('プラットフォーム固有の処理は src/adapters/ の中だけに書いてください。');
process.exit(1);
