/**
 * Vault の基本型。
 *
 * ここには「プラットフォーム固有の型」を絶対に持ち込まないこと（設計書 §13.4 ルール2）。
 * FileSystemFileHandle のようなブラウザ固有の型が1つでも混ざった時点で境界は破れる。
 */

/**
 * Vault ルートからの相対パス。
 * - 常にスラッシュ区切り  例: "AI/Ollama.md"
 * - 先頭・末尾にスラッシュを付けない
 * - ルート自身は空文字列 ""
 *
 * ノートの識別子は「ただの文字列」。ハンドルなどのオブジェクトを持ち回らない。
 */
export type VPath = string;

export interface Entry {
  path: VPath;
  name: string;
  kind: 'file' | 'dir';
  /** list(..., withStat=true) のときだけ埋まる。差分インデックスに使う。 */
  mtime?: number;
  size?: number;
}

export interface Stat {
  /** 最終更新時刻 (epoch ミリ秒) */
  mtime: number;
  /** バイト数 */
  size: number;
}

export interface VaultCapabilities {
  /** ユーザーが OS のファイラで直接見られる実フォルダか */
  realFolder: boolean;
  /** 外部変更を push で検知できるか (false ならポーリングに fallback) */
  watch: boolean;
  /** アトミックな rename があるか */
  rename: boolean;
  /** 画像などバイナリを扱えるか */
  binary: boolean;
}

export type FileEvent =
  | { type: 'create'; path: VPath }
  | { type: 'modify'; path: VPath }
  | { type: 'delete'; path: VPath }
  | { type: 'rename'; from: VPath; to: VPath };

export type Unsubscribe = () => void;
