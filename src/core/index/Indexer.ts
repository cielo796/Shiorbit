import type { Entry as VaultEntry, Unsubscribe, VPath } from '../vault/types';
import type { VaultService } from '../vault/VaultService';
import type { LinkRef } from '../markdown/wikilink';
import type { NoteMeta } from '../markdown/scan';
import { aliasesOf, displayTitle, extractContext, frontmatterTags } from '../markdown/scan';
import { isSupportedDocument, stripDocumentExtension } from '../vault/path';
import { scanDocument } from './scanDocument';
import { emptyTables, resolveLink, type ResolveTables } from './resolver';
import { SearchService, makeSnippet } from './SearchService';
import { searchText } from './searchText';
import { nullStore, type KeyValueStore } from '../storage/KeyValueStore';
import { CACHE_VERSION, cacheKey, validateCache, type CachedIndex } from './IndexCache';
import type { GraphInput } from '../graph/types';
import { matchSnippet, type MatchText, type VaultMatches } from '../search/matches';

export interface OutLink {
  ref: LinkRef;
  /** リンクが書かれている行 */
  context: string;
  /** 解決先。null なら未解決 (まだ存在しないノートへの言及) */
  resolved: VPath | null;
}

export interface Backlink {
  from: VPath;
  ref: LinkRef;
  context: string;
}

export interface UnresolvedGroup {
  /** 表示用の名前 (最初に見つかった表記) */
  name: string;
  sources: { path: VPath; ref: LinkRef; context: string }[];
}

export interface Suggestion {
  path: VPath;
  basename: string;
  title: string;
  aliases: string[];
}

export interface SearchResult {
  path: VPath;
  title: string;
  score: number;
  snippet: string;
}

export interface IndexStats {
  notes: number;
  links: number;
  unresolved: number;
}

export interface BuildReport {
  /** 本文を読み直したノート数 */
  scanned: number;
  /** キャッシュを再利用したノート数 */
  reused: number;
  ms: number;
}

export interface IndexerOptions {
  autoCollectTags?: boolean;
  /** インデックスの保存先。省略すると毎回全件スキャンになる。 */
  cache?: KeyValueStore;
  /** 変更後にキャッシュを書き出すまでの待ち時間 */
  persistDelayMs?: number;
}

interface Entry {
  meta: NoteMeta;
  out: OutLink[];
}

/**
 * Vault 全体のリンク構造を保持する。
 *
 * VaultService しか知らないので、ブラウザでもスマホアプリでも Node でも同じように動く。
 * Phase 1 では起動時に全件スキャンする。
 * IndexedDB への永続化と差分復元は Phase 2 (設計書 §5 / §12)。
 */
export class Indexer {
  private readonly entries = new Map<VPath, Entry>();
  private readonly backIndex = new Map<VPath, Backlink[]>();
  private readonly unresolvedIndex = new Map<string, UnresolvedGroup>();
  private readonly listeners = new Set<() => void>();
  private readonly search = new SearchService();
  private tables: ResolveTables = emptyTables();

  private readonly cache: KeyValueStore;
  private readonly persistDelayMs: number;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private cacheDirty = false;
  private cacheRevision = 0;
  private persisting: Promise<void> | null = null;
  private lastReport: BuildReport = { scanned: 0, reused: 0, ms: 0 };
  private autoCollectTags: boolean;

  constructor(
    private readonly vault: VaultService,
    options: IndexerOptions = {},
  ) {
    this.cache = options.cache ?? nullStore;
    this.persistDelayMs = options.persistDelayMs ?? 2000;
    this.autoCollectTags = options.autoCollectTags ?? true;
  }

  get report(): BuildReport {
    return this.lastReport;
  }

  // -------------------------------------------------------------- 構築

  /**
   * インデックスを作る。
   *
   * キャッシュがあれば mtime を突き合わせ、変わったノートだけ読み直す (設計書 §5)。
   * キャッシュが無い・形式が古い・壊れている場合は黙って全件スキャンに落ちる。
   */
  async rebuild(onProgress?: (done: number, total: number) => void, force = false, knownEntries?: readonly VaultEntry[]): Promise<void> {
    const started = Date.now();
    const notes = knownEntries
      ? knownEntries.filter(e => e.kind === 'file' && isSupportedDocument(e.path))
      : await this.vault.listDocuments(true);
    this.entries.clear();

    let toScan: VPath[] = [];
    let reused = 0;

    const cached = force ? null : validateCache(await this.cache.get(cacheKey(this.vault.name)), this.vault.name);

    let cacheReused = false;
    if (cached && await this.search.restore(cached.search)) {
      cacheReused = true;
      const previous = new Map(cached.entries.map((e) => [e.meta.path, e]));
      const alive = new Set<VPath>();

      for (const entry of notes) {
        alive.add(entry.path);
        const old = previous.get(entry.path);
        if (old && entry.mtime !== undefined && old.meta.mtime === entry.mtime) {
          this.entries.set(entry.path, {
            meta: old.meta,
            out: old.out.map((o) => ({ ref: o.ref, context: o.context, resolved: null })),
          });
          reused++;
        } else {
          toScan.push(entry.path);
        }
      }

      // Vault から消えたノートを検索索引からも落とす
      for (const old of cached.entries) {
        if (!alive.has(old.meta.path)) this.search.remove(old.meta.path);
      }
    } else {
      this.search.clear();
      toScan = notes.map((e) => e.path);
    }

    let done = reused;
    let lastYield = Date.now();
    onProgress?.(done, notes.length);
    for (const path of toScan) {
      try {
        await this.load(path);
      } catch {
        // 読めないファイルがあっても全体は止めない
      }
      onProgress?.(++done, notes.length);
      if (Date.now() - lastYield >= 16) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        lastYield = Date.now();
      }
    }

    this.lastReport = { scanned: toScan.length, reused, ms: Date.now() - started };
    this.reindex(!cacheReused || toScan.length > 0 || cached?.entries.length !== notes.length);
  }

  /** 1件だけ再スキャンする。保存直後や外部変更の通知で呼ぶ。 */
  async updateNote(path: VPath): Promise<void> {
    await this.updateNotes([path]);
  }

  /** まとめて読み込み、全リンク再解決・画面通知は一度だけ行う。 */
  async updateNotes(paths: readonly VPath[], removed: readonly VPath[] = []): Promise<void> {
    for (const path of removed) {
      this.entries.delete(path);
      this.search.remove(path);
    }
    let lastYield = Date.now();
    for (const path of new Set(paths)) {
      try { await this.load(path); }
      catch {
        this.entries.delete(path);
        this.search.remove(path);
      }
      if (Date.now() - lastYield >= 16) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        lastYield = Date.now();
      }
    }
    this.reindex();
  }

  removeNote(path: VPath): void {
    this.entries.delete(path);
    this.search.remove(path);
    this.reindex();
  }

  private async load(path: VPath): Promise<void> {
    const note = await this.vault.readNote(path);
    const meta = scanDocument(path, note.text, {
      mtime: note.mtime,
      size: note.text.length,
    });
    const out: OutLink[] = [...meta.links, ...meta.embeds].map((ref) => ({
      ref,
      context: extractContext(note.text, ref.from, ref.to),
      resolved: null,
    }));
    this.entries.set(path, { meta, out });
    this.search.put(meta, note.text);
  }

  // ------------------------------------------------------------ 再解決

  /**
   * リンクを解決し直す。
   * ノートが1件増えるだけで、それまで未解決だったリンクが解決済みに変わるため、
   * 変更のたびに全リンクを引き直す (リンク1本あたり Map 参照1回なので十分速い)。
   */
  private reindex(persist = true): void {
    this.tables = emptyTables();
    for (const { meta } of this.entries.values()) {
      const pathKey = stripDocumentExtension(meta.path).toLowerCase();
      this.tables.byPath.set(pathKey, meta.path);
      push(this.tables.byBasename, meta.basename.toLowerCase(), meta.path);
      for (const alias of aliasesOf(meta)) {
        push(this.tables.byAlias, alias.toLowerCase(), meta.path);
      }
    }

    this.backIndex.clear();
    this.unresolvedIndex.clear();

    for (const [from, entry] of this.entries) {
      for (const out of entry.out) {
        if (out.ref.target === '') {
          out.resolved = from; // [[#見出し]] は自ノート内リンク
          continue;
        }

        const resolved = resolveLink(out.ref.target, from, this.tables);
        out.resolved = resolved;

        if (resolved !== null) {
          if (resolved === from) continue; // 自分自身へのリンクはバックリンクに出さない
          push(this.backIndex, resolved, { from, ref: out.ref, context: out.context });
        } else {
          const key = out.ref.target.toLowerCase();
          const group = this.unresolvedIndex.get(key) ?? { name: out.ref.target, sources: [] };
          group.sources.push({ path: from, ref: out.ref, context: out.context });
          this.unresolvedIndex.set(key, group);
        }
      }
    }

    for (const fn of [...this.listeners]) fn();
    if (persist) {
      this.cacheDirty = true;
      this.cacheRevision++;
      this.schedulePersist();
    }
  }

  // ------------------------------------------------------ キャッシュ保存

  private schedulePersist(): void {
    if (this.cache === nullStore) return;
    if (this.persistTimer !== null) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persist();
    }, this.persistDelayMs);
  }

  /** いますぐ書き出す。ページを閉じる直前などに呼ぶ。 */
  async flush(): Promise<void> {
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    await this.persist();
  }

  private persist(): Promise<void> {
    if (this.persisting) return this.persisting.then(() => this.cacheDirty ? this.persist() : undefined);
    if (!this.cacheDirty || this.cache === nullStore) return Promise.resolve();
    this.persisting = this.persistOnce(this.cacheRevision).finally(() => { this.persisting = null; });
    return this.persisting;
  }

  private async persistOnce(revision: number): Promise<void> {
    const payload: CachedIndex = {
      version: CACHE_VERSION,
      vault: this.vault.name,
      entries: [...this.entries.values()].map((e) => ({
        meta: e.meta,
        out: e.out.map((o) => ({ ref: o.ref, context: o.context })),
      })),
      search: this.search.serialize(),
    };
    try {
      await this.cache.set(cacheKey(this.vault.name), payload);
      if (revision === this.cacheRevision) this.cacheDirty = false;
    } catch (e) {
      console.warn('[Indexer] キャッシュの保存に失敗しました', e);
    }
  }

  dispose(): void {
    if (this.persistTimer !== null) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    this.listeners.clear();
  }

  // -------------------------------------------------------------- 参照

  onChange(fn: () => void): Unsubscribe {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  getMeta(path: VPath): NoteMeta | undefined {
    const meta = this.entries.get(path)?.meta;
    return meta ? this.effectiveMeta(meta) : undefined;
  }

  /** 生の解析結果は保持し、設定のプレビュー／取消でも再読込や本文変更をしない。 */
  setAutoCollectTags(enabled: boolean): void {
    if (this.autoCollectTags === enabled) return;
    this.autoCollectTags = enabled;
    for (const fn of [...this.listeners]) fn();
  }

  private effectiveMeta(meta: NoteMeta): NoteMeta {
    return this.autoCollectTags ? meta : { ...meta, tags: frontmatterTags(meta.frontmatter) };
  }

  has(path: VPath): boolean {
    return this.entries.has(path);
  }

  /** 索引にあるすべてのノートのメタ情報。Bases の問い合わせに使う。 */
  allMeta(): NoteMeta[] {
    return [...this.entries.values()].map(({ meta }) => this.effectiveMeta(meta));
  }

  /** 索引にあるノートのパス。まとめて外すときに使う。 */
  paths(): VPath[] {
    return [...this.entries.keys()];
  }

  /** 指定ノートから出ているリンク (未解決も含む) */
  outgoing(path: VPath): OutLink[] {
    return this.entries.get(path)?.out ?? [];
  }

  /** 指定ノートを参照しているリンク。文脈の行付き。 */
  backlinks(path: VPath): Backlink[] {
    return this.backIndex.get(path) ?? [];
  }

  /** Vault 全体の未解決リンク。「まだ書いていないノート」の一覧になる。 */
  unresolved(): UnresolvedGroup[] {
    return [...this.unresolvedIndex.values()].sort(
      (a, b) => b.sources.length - a.sources.length || a.name.localeCompare(b.name, 'ja'),
    );
  }

  resolve(target: string, from: VPath): VPath | null {
    return resolveLink(target, from, this.tables);
  }

  /** クイックスイッチャ・リンク補完で使う候補一覧 */
  suggestions(): Suggestion[] {
    return [...this.entries.values()].map(({ meta }) => ({
      path: meta.path,
      basename: meta.basename,
      title: displayTitle(meta),
      aliases: aliasesOf(meta),
    }));
  }

  /** グラフ描画用の最小限のスナップショット (設計書 §12 Phase 3) */
  graphInput(): GraphInput[] {
    return [...this.entries.values()].map(({ meta, out }) => ({
      path: meta.path,
      basename: meta.basename,
      links: out.map((o) => ({ target: o.ref.target, resolved: o.resolved })),
    }));
  }

  tags(): Map<string, VPath[]> {
    const map = new Map<string, VPath[]>();
    for (const { meta } of this.entries.values()) {
      for (const tag of this.effectiveMeta(meta).tags) push(map, tag, meta.path);
    }
    return map;
  }

  stats(): IndexStats {
    let links = 0;
    for (const entry of this.entries.values()) links += entry.out.length;
    return { notes: this.entries.size, links, unresolved: this.unresolvedIndex.size };
  }

  // ------------------------------------------------------------ 全文検索

  /** 上位ヒットについてだけ本文を読み直し、検索語の周辺を切り出す。 */
  /**
   * 全文検索。**抜粋（snippet）はここでは作らない。**
   *
   * 抜粋には本文が要るので、上位50件ぶんの読み込みが検索のたびに走っていた。
   * File System Access API やモバイルではファイル1件ごとの往復が高いので、
   * 実際に画面へ出た行だけ `snippetFor` で取りに行く形にした（ROADMAP 7.5）。
   */
  async searchNotes(query: string, limit = 50): Promise<SearchResult[]> {
    return this.search.search(query, limit, this.autoCollectTags).flatMap((hit) => {
      const meta = this.entries.get(hit.path)?.meta;
      return meta ? [{ path: hit.path, title: displayTitle(meta), score: hit.score, snippet: '' }] : [];
    });
  }

  /** 検索結果の抜粋。読めなければ空文字（表示は落とさない）。 */
  async snippetFor(path: VPath, query: string): Promise<string> {
    try {
      return makeSnippet(searchText(path, (await this.vault.readNote(path)).text), query);
    } catch {
      return '';
    }
  }

  /**
   * サイドバーと同じ検索索引で候補を並べ、エディタと同じ照合器で位置・件数を確定する。
   * 正規表現・語の途中・記号は単語索引だけでは拾えないため残りの文書も調べる。
   * 本文は保持せず、表示する抜粋だけ返す。古い入力はファイルの読み込み間で中断する。
   */
  async searchMatches(
    query: string,
    match: MatchText,
    options: { cancelled: () => boolean; drafts?: ReadonlyMap<VPath, string> },
  ): Promise<VaultMatches> {
    const ranked = this.search.search(query, this.entries.size, this.autoCollectTags).map((hit) => hit.path);
    const paths = new Set([...ranked, ...this.entries.keys(), ...(options.drafts?.keys() ?? [])]);
    const result: VaultMatches = { documents: [], total: 0, skipped: 0 };
    for (const path of paths) {
      if (options.cancelled()) break;
      try {
        // CodeMirrorは改行をLFへ正規化する。位置と抜粋も同じ座標系に揃える。
        const text = (options.drafts?.get(path) ?? (await this.vault.readNote(path)).text).replace(/\r\n?/g, '\n');
        if (options.cancelled()) break;
        const matches = match(text);
        if (!matches.length) continue;
        result.total += matches.length;
        result.documents.push({
          path, title: this.getMeta(path) ? displayTitle(this.getMeta(path)!) : path,
          count: matches.length,
          ranges: matches,
          matches: matches.slice(0, 100).map((hit) => matchSnippet(text, hit)),
        });
      } catch { result.skipped++; }
    }
    return result;
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
