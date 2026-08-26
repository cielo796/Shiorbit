import type { NoteMeta } from '../markdown/scan';
import type { LinkRef } from '../markdown/wikilink';

/** 形式を変えたらここを上げる。古いキャッシュは自動的に捨てられる。 */
// 3: HTML からのリンクを持つようになった（2 のキャッシュは links: [] のままなので捨てる）
export const CACHE_VERSION = 3;

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
  }

  return c as CachedIndex;
}
