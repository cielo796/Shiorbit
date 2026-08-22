import type { Entry, FileEvent, Stat, Unsubscribe, VaultCapabilities, VPath } from './types';

/**
 * ============================================================
 *  これが「境界」そのもの (設計書 §13)
 * ============================================================
 *
 * このファイルには interface しか書かない。実装コードは1行も置かない。
 *
 * アプリ本体 (src/core, src/ui) はこの約束だけを使い、
 * 「どうやって保存されるか」を一切知らない。
 * プラットフォーム固有の実装は src/adapters/ 配下だけに置く。
 *
 * ルール (§13.4):
 *   1. showDirectoryPicker などの固有識別子を src/adapters/ の外に出さない
 *   2. ノートの識別子は VPath (ただの文字列)。ハンドルを持ち回らない
 *   3. 全メソッドが Promise を返す (同期に読めると仮定しない)
 *
 * 新しいプラットフォームに対応する = このファイルを実装したクラスを1つ足すだけ。
 * UI もコアも1行も変わらない。
 */
export interface VaultAdapter {
  /** 実装の識別子。'memory' | 'fsa' | 'capacitor' | 'node' など */
  readonly id: string;

  /** Vault の表示名 (フォルダ名) */
  readonly name: string;

  readonly caps: VaultCapabilities;

  /**
   * dir 配下を列挙する。dir='' はルート。
   * withStat=true のときは Entry に mtime / size を詰める
   * (差分インデックス用。毎回取ると重いので既定は false)。
   */
  list(dir: VPath, recursive: boolean, withStat?: boolean): Promise<Entry[]>;

  read(path: VPath): Promise<string>;
  readBinary(path: VPath): Promise<ArrayBuffer>;

  write(path: VPath, text: string): Promise<void>;
  writeBinary(path: VPath, data: ArrayBuffer): Promise<void>;

  rename(from: VPath, to: VPath): Promise<void>;
  remove(path: VPath): Promise<void>;
  mkdir(path: VPath): Promise<void>;

  stat(path: VPath): Promise<Stat>;
  exists(path: VPath): Promise<boolean>;

  /** caps.watch が true のときのみ実装される。false なら VaultService がポーリングする。 */
  watch?(onEvent: (ev: FileEvent) => void): Unsubscribe;
}
