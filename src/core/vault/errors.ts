export type VaultErrorCode =
  | 'ENOENT'    // 存在しない
  | 'EEXIST'    // すでに存在する
  | 'EPERM'     // 権限がない
  | 'EISDIR'    // ディレクトリに対するファイル操作
  | 'ENOTDIR'   // ファイルに対するディレクトリ操作
  | 'ECONFLICT' // 外部で変更されている (設計書 §9)
  | 'EIO';      // その他の入出力エラー

export class VaultError extends Error {
  override readonly name = 'VaultError';

  constructor(
    readonly code: VaultErrorCode,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}

export const enoent = (path: string): VaultError =>
  new VaultError('ENOENT', `見つかりません: ${path || '(ルート)'}`);

export const eexist = (path: string): VaultError =>
  new VaultError('EEXIST', `すでに存在します: ${path}`);

export const eisdir = (path: string): VaultError =>
  new VaultError('EISDIR', `ディレクトリです: ${path}`);

export const enotdir = (path: string): VaultError =>
  new VaultError('ENOTDIR', `ディレクトリではありません: ${path}`);

export const eperm = (message: string, cause?: unknown): VaultError =>
  new VaultError('EPERM', message, cause);

/** 外部で変更されたファイルを上書きしようとした。データを黙って捨てないための番人 (設計書 §9)。 */
export class ConflictError extends VaultError {
  constructor(
    readonly path: string,
    readonly baseMtime: number,
    readonly actualMtime: number,
  ) {
    super('ECONFLICT', `外部で変更されています: ${path}`);
  }
}

export function isVaultError(e: unknown, code?: VaultErrorCode): e is VaultError {
  return e instanceof VaultError && (code === undefined || e.code === code);
}
