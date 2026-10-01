import type { NoteMeta } from '../markdown/scan';
import type { LinkRef } from '../markdown/wikilink';
import { MAX_CONTEXT_LENGTH } from '../text/excerpt';

/** 形式を変えたらここを上げる。古いキャッシュは自動的に捨てられる。 */
// 6: HTML文脈を短い表示テキストに制限。巨大な旧値を取得しないようキーも版別にする。
export const CACHE_VERSION = 6;

export interface CachedLink {
  ref: LinkRef;
  context: string;
}

export interface CachedEntry {
  meta: NoteMeta;
  out: CachedLink[];
}

export interface CachedIndex {
  version: number;
  vault: string;
  entries: CachedEntry[];
  /** MiniSearch の索引 */
  search: string;
}

export function cacheKey(vaultName: string): string {
  return `index:v${CACHE_VERSION}:${vaultName}`;
}

/** 索引だけの旧キー。設定・Vaultハンドルの移行用定数とは別物。 */
export function legacyCacheKey(vaultName: string): string {
  return `index:${vaultName}`;
}

/**
 * 保存されていたキャッシュを検証する。
 *
 * 形式が違う・Vault が違う・壊れている場合は null を返し、呼び出し側は全件スキャンに落ちる。
 * キャッシュは「あれば速い」だけのものなので、少しでも怪しければ捨てるのが正しい。
 */
export function validateCache(raw: unknown, vaultName: string): CachedIndex | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const c = raw as Partial<CachedIndex>;

  if (c.version !== CACHE_VERSION) return null;
  if (c.vault !== vaultName) return null;
  if (!Array.isArray(c.entries)) return null;
  if (typeof c.search !== 'string') return null;

  for (const entry of c.entries) {
    if (typeof entry !== 'object' || entry === null) return null;
    const meta = (entry as CachedEntry).meta as Partial<NoteMeta> | undefined;
    if (!meta || typeof meta.path !== 'string' || typeof meta.mtime !== 'number') return null;
    if (!Array.isArray((entry as CachedEntry).out)) return null;
    for (const link of (entry as CachedEntry).out) {
      if (!link || typeof link.context !== 'string' || link.context.length > MAX_CONTEXT_LENGTH) return null;
      if (!link.ref || typeof link.ref.target !== 'string') return null;
    }
  }

  return c as CachedIndex;
}
