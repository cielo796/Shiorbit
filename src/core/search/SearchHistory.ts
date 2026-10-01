import type { VaultService } from '../vault/VaultService';

export interface SearchHistoryEntry { term: string; count: number }
export const SEARCH_HISTORY_PATH = '.shiorbit/search-history.json';
const LIMIT = 8;

/** 履歴はVaultごと。クエリだけを保存し、置換文字列や開閉状態は永続化しない。 */
export class SearchHistory {
  private entries: SearchHistoryEntry[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly vault?: VaultService, private readonly onError?: (error: unknown) => void) {}

  get items(): readonly SearchHistoryEntry[] { return this.entries; }

  async load(): Promise<void> {
    if (!this.vault) return;
    try {
      const raw: unknown = JSON.parse((await this.vault.readNote(SEARCH_HISTORY_PATH)).text);
      if (!Array.isArray(raw)) return;
      const seen = new Set<string>();
      this.entries = raw.filter((item): item is SearchHistoryEntry => {
        if (!item || typeof item !== 'object') return false;
        const entry = item as Partial<SearchHistoryEntry>;
        if (typeof entry.term !== 'string' || !entry.term.trim() || entry.term.length > 10000 || seen.has(entry.term)) return false;
        if (typeof entry.count !== 'number' || !Number.isSafeInteger(entry.count) || entry.count < 0) return false;
        seen.add(entry.term);
        return true;
      }).slice(0, LIMIT).map(({ term, count }) => ({ term, count }));
    } catch { /* 履歴がない・壊れている場合でも検索は使える。 */ }
  }

  remember(term: string, count: number): void {
    if (!term.trim() || term.length > 10000 || !Number.isSafeInteger(count) || count < 0) return;
    if (this.entries[0]?.term === term && this.entries[0]?.count === count) return;
    this.entries = [{ term, count }, ...this.entries.filter((item) => item.term !== term)].slice(0, LIMIT);
    const payload = JSON.stringify(this.entries, null, 2) + '\n';
    this.queue = this.queue.then(async () => {
      if (!this.vault) return;
      await this.vault.mkdir('.shiorbit');
      await this.vault.writeNote(SEARCH_HISTORY_PATH, payload);
    }).catch((error: unknown) => this.onError?.(error));
  }

  async flush(): Promise<void> { await this.queue; }
}
