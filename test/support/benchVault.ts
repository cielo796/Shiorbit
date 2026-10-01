import { MemoryAdapter } from '../../src/adapters/memory';
import type { VaultAdapter } from '../../src/core/vault/VaultAdapter';
import type { Entry, FileEvent, Stat, Unsubscribe, VPath } from '../../src/core/vault/types';

export interface BenchVaultOptions {
  notes: number;
  /** 1ノートあたりのリンク数 */
  links?: number;
  folders?: number;
}

/**
 * 計測用の合成 Vault。
 *
 * ディスクではなくメモリに作る。測りたいのは自分たちのコードの計算量で、
 * 環境ごとに揺れるディスク速度ではないため（I/O の**回数**は別に数える）。
 */
export async function buildBenchVault(opts: BenchVaultOptions): Promise<MemoryAdapter> {
  const adapter = new MemoryAdapter('Bench');
  const links = opts.links ?? 5;
  const folders = opts.folders ?? 50;

  for (let i = 0; i < opts.notes; i++) {
    const folder = `topic${i % folders}`;
    const targets = Array.from({ length: links }, (_, k) => `note${(i * 7 + k * 13 + 1) % opts.notes}`);
    const body = [
      '---',
      `title: ノート ${i}`,
      `status: ${i % 3 === 0 ? '読了' : '未読'}`,
      `rating: ${i % 5}`,
      '---',
      '',
      `# ノート ${i}`,
      '',
      `#tag${i % 20} のメモ。ローカルLLMの実行環境について書く。`,
      '',
      ...targets.map((target) => `- [[${target}]] を参照`),
      '',
      '## 詳細',
      '',
      `本文 ${i}。日本語の全文検索が効くように、それなりの長さの文章を入れておく。`,
    ].join('\n');

    await adapter.write(`${folder}/note${i}.md`, body);
  }

  return adapter;
}

export interface CallCounts {
  list: number;
  read: number;
  stat: number;
  exists: number;
  write: number;
}

export interface CountingAdapter {
  adapter: VaultAdapter;
  counts: CallCounts;
  reset: () => void;
}

/**
 * 呼び出し回数を数えるための包み。
 * 「ファイル数に比例して I/O が増えていないか」を、時間ではなく回数で固定する。
 */
export function countCalls(inner: VaultAdapter): CountingAdapter {
  const counts: CallCounts = { list: 0, read: 0, stat: 0, exists: 0, write: 0 };

  const adapter: VaultAdapter = {
    get id() {
      return inner.id;
    },
    get name() {
      return inner.name;
    },
    get caps() {
      return inner.caps;
    },
    list: (dir: VPath, recursive: boolean, withStat?: boolean): Promise<Entry[]> => {
      counts.list++;
      return inner.list(dir, recursive, withStat);
    },
    read: (path: VPath): Promise<string> => {
      counts.read++;
      return inner.read(path);
    },
    readBinary: (path: VPath): Promise<ArrayBuffer> => inner.readBinary(path),
    write: (path: VPath, text: string): Promise<void> => {
      counts.write++;
      return inner.write(path, text);
    },
    writeBinary: (path: VPath, data: ArrayBuffer): Promise<void> => inner.writeBinary(path, data),
    rename: (from: VPath, to: VPath): Promise<void> => inner.rename(from, to),
    remove: (path: VPath): Promise<void> => inner.remove(path),
    mkdir: (path: VPath): Promise<void> => inner.mkdir(path),
    stat: (path: VPath): Promise<Stat> => {
      counts.stat++;
      return inner.stat(path);
    },
    exists: (path: VPath): Promise<boolean> => {
      counts.exists++;
      return inner.exists(path);
    },
  };

  if (inner.watch) {
    adapter.watch = (onEvent: (ev: FileEvent) => void): Unsubscribe => inner.watch!(onEvent);
  }

  return {
    adapter,
    counts,
    reset: () => {
      counts.list = 0;
      counts.read = 0;
      counts.stat = 0;
      counts.exists = 0;
      counts.write = 0;
    },
  };
}
