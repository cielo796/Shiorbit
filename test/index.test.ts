import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryAdapter } from '../src/adapters/memory';
import { VaultService } from '../src/core/vault/VaultService';
import { Indexer } from '../src/core/index/Indexer';
import { emptyTables, resolveLink } from '../src/core/index/resolver';
import { makeSnippet, tokenize } from '../src/core/index/SearchService';

function tables(paths: string[]) {
  const t = emptyTables();
  for (const p of paths) {
    const key = p.replace(/\.md$/i, '');
    t.byPath.set(key.toLowerCase(), p);
    const base = key.split('/').pop()!.toLowerCase();
    t.byBasename.set(base, [...(t.byBasename.get(base) ?? []), p]);
  }
  return t;
}

describe('resolveLink — 設計書 §5 の解決規則', () => {
  it('1. 完全一致パス', () => {
    const t = tables(['AI/Ollama.md', 'Ollama.md']);
    expect(resolveLink('AI/Ollama', 'x.md', t)).toBe('AI/Ollama.md');
  });

  it('2. basename がちょうど1件なら解決する', () => {
    const t = tables(['AI/Ollama.md']);
    expect(resolveLink('Ollama', 'Daily/2026-08-20.md', t)).toBe('AI/Ollama.md');
  });

  it('3. 複数一致ならリンク元に近いほうを選ぶ', () => {
    const t = tables(['AI/Note.md', 'Daily/Note.md']);
    expect(resolveLink('Note', 'Daily/2026-08-20.md', t)).toBe('Daily/Note.md');
    expect(resolveLink('Note', 'AI/Ollama.md', t)).toBe('AI/Note.md');
  });

  it('4. 見つからなければ null (未解決リンク)', () => {
    expect(resolveLink('Nothing', 'a.md', tables(['a.md']))).toBeNull();
  });

  it('大文字小文字を区別しない', () => {
    expect(resolveLink('ollama', 'x.md', tables(['AI/Ollama.md']))).toBe('AI/Ollama.md');
  });

  it('パス付き指定は basename 一致で救わない', () => {
    expect(resolveLink('Wrong/Ollama', 'x.md', tables(['AI/Ollama.md']))).toBeNull();
  });

  it('.md 付きで書かれても解決する', () => {
    expect(resolveLink('Ollama.md', 'x.md', tables(['AI/Ollama.md']))).toBe('AI/Ollama.md');
  });
});

describe('Indexer', () => {
  let adapter: MemoryAdapter;
  let vault: VaultService;
  let index: Indexer;

  beforeEach(async () => {
    adapter = new MemoryAdapter('T');
    vault = new VaultService(adapter, { mtimeToleranceMs: 0 });
    index = new Indexer(vault);
    await adapter.write('AI/Ollama.md', '# Ollama\n\n[[LocalLLM]] の実行環境。\n[[MCP]] とも繋がる。\n');
    await adapter.write('AI/LocalLLM.md', '# LocalLLM\n\n手元で動かす LLM。\n');
    await index.rebuild();
  });

  it('バックリンクを文脈付きで返す', () => {
    const backs = index.backlinks('AI/LocalLLM.md');
    expect(backs).toHaveLength(1);
    expect(backs[0]!.from).toBe('AI/Ollama.md');
    expect(backs[0]!.context).toBe('[[LocalLLM]] の実行環境。');
  });

  it('未解決リンクを「まだ書いていないノート」として集める', () => {
    const un = index.unresolved();
    expect(un.map((g) => g.name)).toEqual(['MCP']);
    expect(un[0]!.sources[0]!.path).toBe('AI/Ollama.md');
  });

  it('ノートを作ると未解決リンクが解決済みに変わる', async () => {
    await adapter.write('AI/MCP.md', '# MCP\n');
    await index.updateNote('AI/MCP.md');

    expect(index.unresolved()).toEqual([]);
    expect(index.backlinks('AI/MCP.md').map((b) => b.from)).toEqual(['AI/Ollama.md']);
  });

  it('ノートを消すとリンクが未解決に戻る', () => {
    index.removeNote('AI/LocalLLM.md');
    expect(index.unresolved().map((g) => g.name).sort()).toEqual(['LocalLLM', 'MCP']);
  });

  it('outgoing が解決先つきでリンクを返す', () => {
    const out = index.outgoing('AI/Ollama.md');
    expect(out.map((o) => [o.ref.target, o.resolved])).toEqual([
      ['LocalLLM', 'AI/LocalLLM.md'],
      ['MCP', null],
    ]);
  });

  it('自分自身へのリンクはバックリンクに出さない', async () => {
    await adapter.write('Self.md', '# Self\n[[Self]] と [[#見出し]]\n');
    await index.updateNote('Self.md');
    expect(index.backlinks('Self.md')).toEqual([]);
  });

  it('変更を購読できる', async () => {
    let calls = 0;
    index.onChange(() => calls++);
    await adapter.write('New.md', '# New');
    await index.updateNote('New.md');
    expect(calls).toBe(1);
  });

  it('stats がノート数・リンク数・未解決数を返す', () => {
    expect(index.stats()).toEqual({ notes: 2, links: 2, unresolved: 1 });
  });

  it('suggestions が候補を返す', () => {
    expect(index.suggestions().map((s) => s.basename).sort()).toEqual(['LocalLLM', 'Ollama']);
  });

  it('tags を集計する', async () => {
    await adapter.write('Tagged.md', '#ai #llm の話\n');
    await index.updateNote('Tagged.md');
    const tags = index.tags();
    expect([...tags.keys()].sort()).toEqual(['ai', 'llm']);
    expect(tags.get('ai')).toEqual(['Tagged.md']);
  });
});

describe('全文検索', () => {
  it('日本語をビグラムに分割する', () => {
    expect(tokenize('ローカルLLM')).toEqual(['ロー', 'ーカ', 'カル', 'llm']);
    expect(tokenize('猫')).toEqual(['猫']);
    expect(tokenize('Hello, world!')).toEqual(['hello', 'world']);
  });

  it('日本語の部分一致で検索できる', async () => {
    const adapter = new MemoryAdapter('T');
    const vault = new VaultService(adapter, { mtimeToleranceMs: 0 });
    const index = new Indexer(vault);
    await adapter.write('a.md', '# Ollama\nローカルLLMの実行環境について書く。\n');
    await adapter.write('b.md', '# 料理\n今日はカレーを作った。\n');
    await index.rebuild();

    expect((await index.searchNotes('ローカル')).map((r) => r.path)).toEqual(['a.md']);
    expect((await index.searchNotes('実行環境')).map((r) => r.path)).toEqual(['a.md']);
    expect((await index.searchNotes('カレー')).map((r) => r.path)).toEqual(['b.md']);
    expect(await index.searchNotes('存在しない語句xyz')).toEqual([]);
  });

  it('タイトル一致を本文一致より上位にする', async () => {
    const adapter = new MemoryAdapter('T');
    const vault = new VaultService(adapter, { mtimeToleranceMs: 0 });
    const index = new Indexer(vault);
    await adapter.write('Ollama.md', '# Ollama\n本文\n');
    await adapter.write('other.md', 'Ollama について少し触れる\n');
    await index.rebuild();

    expect((await index.searchNotes('Ollama'))[0]!.path).toBe('Ollama.md');
  });

  it('スニペットが検索語の周辺を切り出す', () => {
    const text = 'あ'.repeat(200) + 'キーワード' + 'い'.repeat(200);
    const snippet = makeSnippet(text, 'キーワード');
    expect(snippet).toContain('キーワード');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThan(140);
  });
});
