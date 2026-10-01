import MiniSearch from 'minisearch';
import type { VPath } from '../vault/types';
import type { NoteMeta } from '../markdown/scan';
import { frontmatterTags } from '../markdown/scan';
import { searchText } from './searchText';

export interface SearchHit {
  path: VPath;
  score: number;
}

const LATIN = /[A-Za-z0-9_]/;
const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/;

/**
 * 日本語対応トークナイザ。
 *
 * 空白で区切る一般的なトークナイザは日本語で機能しない
 * ("ローカルLLMの実行環境" が丸ごと1語になってしまう)。
 * そこで、ラテン文字と数字は単語単位、日本語・中国語・韓国語は
 * 2文字ずつのビグラムに分割する。形態素解析辞書を持たずに
 * 部分一致検索を成立させる、軽量で確実な方法。
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const n = text.length;
  let i = 0;

  while (i < n) {
    const ch = text[i]!;

    if (LATIN.test(ch)) {
      let j = i;
      while (j < n && LATIN.test(text[j]!)) j++;
      tokens.push(text.slice(i, j).toLowerCase());
      i = j;
      continue;
    }

    if (CJK.test(ch)) {
      let j = i;
      while (j < n && CJK.test(text[j]!)) j++;
      const run = text.slice(i, j);
      if (run.length === 1) {
        tokens.push(run);
      } else {
        for (let k = 0; k + 1 < run.length; k++) tokens.push(run.slice(k, k + 2));
      }
      i = j;
      continue;
    }

    i++;
  }

  return tokens;
}

interface Doc {
  id: string;
  title: string;
  body: string;
  tags: string;
  autoTags: string;
}

const MINI_OPTIONS = {
  fields: ['title', 'body', 'tags', 'autoTags'],
  storeFields: [],
  tokenize,
  processTerm: (term: string) => term.toLowerCase(),
  searchOptions: {
    boost: { title: 4, tags: 2, autoTags: 2 },
    prefix: true,
    combineWith: 'AND' as const,
  },
};

export class SearchService {
  private mini = this.create();

  private create(): MiniSearch<Doc> {
    return new MiniSearch<Doc>(MINI_OPTIONS);
  }

  /** キャッシュ用に索引を文字列化する */
  serialize(): string {
    return JSON.stringify(this.mini);
  }

  /**
   * 文字列化された索引を復元する。
   * MiniSearch のバージョンが変わると読めないので、失敗したら false を返して全件作り直させる。
   */
  async restore(json: string): Promise<boolean> {
    try {
      this.mini = await MiniSearch.loadJSONAsync<Doc>(json, MINI_OPTIONS);
      return true;
    } catch (e) {
      console.warn('[SearchService] 索引の復元に失敗したため作り直します', e);
      this.mini = this.create();
      return false;
    }
  }

  clear(): void {
    this.mini = this.create();
  }

  put(meta: NoteMeta, text: string): void {
    this.remove(meta.path);
    const manual = frontmatterTags(meta.frontmatter);
    this.mini.add({
      id: meta.path,
      title: `${meta.basename} ${meta.path}`,
      body: searchText(meta.path, text),
      tags: manual.join(' '),
      autoTags: meta.tags.filter((tag) => !manual.includes(tag)).join(' '),
    });
  }

  remove(path: VPath): void {
    if (this.mini.has(path)) this.mini.discard(path);
  }

  search(query: string, limit = 50, autoCollectTags = true): SearchHit[] {
    const q = query.trim();
    if (q === '') return [];
    return this.mini
      // OFFでも本文中の文字は通常の全文検索対象。タグとしての加点だけ外す。
      .search(q, { fields: autoCollectTags ? ['title', 'body', 'tags', 'autoTags'] : ['title', 'body', 'tags'] })
      .slice(0, limit)
      .map((r) => ({ path: r.id as VPath, score: r.score }));
  }
}

/** 検索語の周辺を切り出す。見つからなければ本文の先頭を返す。 */
export function makeSnippet(text: string, query: string, radius = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();

  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => t !== '')
    .map((t) => t.toLowerCase());

  let at = -1;
  for (const term of terms) {
    const i = lower.indexOf(term);
    if (i >= 0 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) return flat.slice(0, radius * 2) + (flat.length > radius * 2 ? '…' : '');

  const start = Math.max(0, at - radius);
  const end = Math.min(flat.length, at + radius);
  return (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '');
}
