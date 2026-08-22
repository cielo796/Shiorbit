import type { VaultAdapter } from '../core/vault/VaultAdapter';
import type { Entry, Stat, VaultCapabilities, VPath } from '../core/vault/types';
import { eexist, eisdir, enoent } from '../core/vault/errors';
import { basename, dirname, isAncestor, normalize } from '../core/vault/path';

interface MemFile {
  text: string | null;
  bin: ArrayBuffer | null;
  mtime: number;
  size: number;
}

/**
 * ファイルではなく Map に読み書きするニセの Vault。
 *
 * 用途は2つ (設計書 §13.5):
 *   1. ブラウザ・ファイルシステムなしでコアをテストする
 *   2. 「境界が壊れていないこと」を検知するセンサー
 *
 * これを差し込んでコアのテストが通る = プラットフォーム依存が漏れていない。
 */
export class MemoryAdapter implements VaultAdapter {
  readonly id = 'memory';
  readonly caps: VaultCapabilities = {
    realFolder: false,
    watch: false,
    rename: true,
    binary: true,
  };

  private readonly files = new Map<VPath, MemFile>();
  private readonly dirs = new Set<VPath>();
  private clock = 1_700_000_000_000;

  constructor(readonly name = 'MemoryVault') {}

  /** テスト用: mtime を単調増加させて変更を検知できるようにする */
  private nextMtime(): number {
    this.clock += 1000;
    return this.clock;
  }

  private ensureParents(path: VPath): void {
    let dir = dirname(path);
    while (dir !== '') {
      this.dirs.add(dir);
      dir = dirname(dir);
    }
  }

  async list(dir: VPath, recursive: boolean, withStat = false): Promise<Entry[]> {
    const base = normalize(dir);
    const out: Entry[] = [];

    const consider = (path: VPath, kind: 'file' | 'dir'): void => {
      if (path === '' || path === base) return;
      if (base !== '' && !isAncestor(base, path)) return;
      const rel = base === '' ? path : path.slice(base.length + 1);
      if (!recursive && rel.includes('/')) return;
      const entry: Entry = { path, name: basename(path), kind };
      if (withStat && kind === 'file') {
        const f = this.files.get(path);
        if (f) {
          entry.mtime = f.mtime;
          entry.size = f.size;
        }
      }
      out.push(entry);
    };

    for (const d of this.dirs) consider(d, 'dir');
    for (const p of this.files.keys()) consider(p, 'file');
    return out;
  }

  async read(path: VPath): Promise<string> {
    const p = normalize(path);
    const f = this.files.get(p);
    if (!f) throw this.dirs.has(p) ? eisdir(p) : enoent(p);
    if (f.text === null) throw new Error(`バイナリファイルです: ${p}`);
    return f.text;
  }

  async readBinary(path: VPath): Promise<ArrayBuffer> {
    const p = normalize(path);
    const f = this.files.get(p);
    if (!f) throw enoent(p);
    if (f.bin) return f.bin;
    return new TextEncoder().encode(f.text ?? '').buffer as ArrayBuffer;
  }

  async write(path: VPath, text: string): Promise<void> {
    const p = normalize(path);
    if (this.dirs.has(p)) throw eisdir(p);
    this.ensureParents(p);
    this.files.set(p, {
      text,
      bin: null,
      mtime: this.nextMtime(),
      size: new TextEncoder().encode(text).length,
    });
  }

  async writeBinary(path: VPath, data: ArrayBuffer): Promise<void> {
    const p = normalize(path);
    if (this.dirs.has(p)) throw eisdir(p);
    this.ensureParents(p);
    this.files.set(p, { text: null, bin: data, mtime: this.nextMtime(), size: data.byteLength });
  }

  async rename(from: VPath, to: VPath): Promise<void> {
    const a = normalize(from);
    const b = normalize(to);
    if (a === b) return;
    if (this.files.has(b) || this.dirs.has(b)) throw eexist(b);

    if (this.files.has(a)) {
      this.ensureParents(b);
      this.files.set(b, this.files.get(a)!);
      this.files.delete(a);
      return;
    }

    if (this.dirs.has(a)) {
      this.ensureParents(b);
      this.dirs.add(b);
      for (const d of [...this.dirs]) {
        if (isAncestor(a, d)) {
          this.dirs.add(b + d.slice(a.length));
          this.dirs.delete(d);
        }
      }
      for (const p of [...this.files.keys()]) {
        if (isAncestor(a, p)) {
          this.files.set(b + p.slice(a.length), this.files.get(p)!);
          this.files.delete(p);
        }
      }
      this.dirs.delete(a);
      return;
    }

    throw enoent(a);
  }

  async remove(path: VPath): Promise<void> {
    const p = normalize(path);
    if (this.files.delete(p)) return;
    if (this.dirs.has(p)) {
      for (const d of [...this.dirs]) if (d === p || isAncestor(p, d)) this.dirs.delete(d);
      for (const f of [...this.files.keys()]) if (isAncestor(p, f)) this.files.delete(f);
      return;
    }
    throw enoent(p);
  }

  async mkdir(path: VPath): Promise<void> {
    const p = normalize(path);
    if (p === '') return;
    if (this.files.has(p)) throw eexist(p);
    this.ensureParents(p);
    this.dirs.add(p);
  }

  async stat(path: VPath): Promise<Stat> {
    const p = normalize(path);
    const f = this.files.get(p);
    if (f) return { mtime: f.mtime, size: f.size };
    if (this.dirs.has(p) || p === '') return { mtime: 0, size: 0 };
    throw enoent(p);
  }

  async exists(path: VPath): Promise<boolean> {
    const p = normalize(path);
    return this.files.has(p) || this.dirs.has(p);
  }
}

/** FSA 非対応ブラウザで UI を確認するためのデモ Vault */
export async function createDemoAdapter(): Promise<MemoryAdapter> {
  const a = new MemoryAdapter('DemoVault (保存されません)');

  await a.write(
    'ようこそ.md',
    [
      '# Shiorbit へようこそ',
      '',
      'これは **デモモード** です。お使いのブラウザは File System Access API に',
      '対応していないため、実際のフォルダではなくメモリ上で動いています。',
      'リロードすると内容は消えます。',
      '',
      'PC の Chrome または Edge で開くと、実際のフォルダを選んで',
      '`.md` ファイルを直接編集できます。',
      '',
      '## まず見てほしいもの',
      '',
      '- [[使い方]] — 操作の一覧',
      '- [[AI/Ollama|Ollama のノート]] — リンクが張られたノートの例',
      '- [[グラフビュー]] — まだ存在しないノートへのリンク（未解決リンク）',
      '',
      '未解決リンクは色が違います。クリックするとそのノートを作れます。',
      '左サイドバーの「未解決」タブに一覧が出ます。',
    ].join('\n'),
  );

  await a.write(
    '使い方.md',
    [
      '# 使い方',
      '',
      '## リンク',
      '',
      '- `[[ノート名]]` で他のノートにリンクする',
      '- `[[` と打つと候補が出る',
      '- `[[ノート名|表示名]]` で表示を変える',
      '- Ctrl（Mac は Cmd）を押しながらリンクをクリックすると移動する',
      '- Ctrl+Enter でもカーソル位置のリンクを開ける',
      '',
      '## ショートカット',
      '',
      '| キー | 動作 |',
      '| --- | --- |',
      '| Ctrl+O | ノートを切り替える |',
      '| Ctrl+Shift+F | 全文検索 |',
      '| Ctrl+S | すぐ保存する |',
      '',
      '関連: [[AI/Ollama]]',
    ].join('\n'),
  );

  await a.write(
    'AI/Ollama.md',
    [
      '---',
      'tags: [ai, llm]',
      'aliases: [オラマ]',
      '---',
      '# Ollama',
      '',
      '[[LocalLLM]] をローカルで動かすための実行環境。',
      '',
      'モデルの取得と実行をコマンド1つで行える。 [[MCP]] とつなぐ構成も試したい。',
      '',
      '## メモ',
      '',
      '手元の GPU メモリに収まるモデルを選ぶのが肝心。 ^model-size',
    ].join('\n'),
  );

  await a.write(
    'AI/LocalLLM.md',
    [
      '---',
      'tags: [ai, llm]',
      '---',
      '# LocalLLM',
      '',
      '手元の PC で動かす大規模言語モデルのこと。',
      '実行環境としては [[Ollama]] が手軽。',
      '',
      'クラウドに送らずに済むので、[[ようこそ]] に書いたような',
      '「データを自分で持つ」考え方と相性がいい。',
    ].join('\n'),
  );

  await a.write(
    'Templates/Daily.md',
    [
      '# {{title}}',
      '',
      '作成: {{date:YYYY年M月D日(ddd)}} {{time}}',
      '',
      '## やったこと',
      '',
      '## 気づき',
      '',
      '#日報',
    ].join('\n'),
  );

  await a.write(
    'Daily/2026-08-20.md',
    [
      '# 2026-08-20',
      '',
      '- [x] Shiorbit Phase 0 を動かす',
      '- [ ] [[Ollama]] を入れてみる',
      '- [ ] [[グラフビュー]] の設計を読む',
      '',
      '#日報',
    ].join('\n'),
  );

  return a;
}
