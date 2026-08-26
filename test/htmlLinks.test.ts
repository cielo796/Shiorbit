import { describe, expect, it } from 'vitest';
import { MemoryAdapter } from '../src/adapters/memory';
import { VaultService } from '../src/core/vault/VaultService';
import { Indexer } from '../src/core/index/Indexer';
import { parseHtmlLinks, scanDocument } from '../src/core/index/scanDocument';
import { applyRenamePlan, planRename } from '../src/core/refactor/planRename';
import { relative } from '../src/core/vault/path';

const stat = { mtime: 1, size: 1 };

describe('相対パス', () => {
  it('同じフォルダならファイル名だけ', () => {
    expect(relative('web', 'web/page.html')).toBe('page.html');
  });

  it('上へ辿る分だけ .. を積む', () => {
    expect(relative('web/deep', 'AI/Ollama.md')).toBe('../../AI/Ollama.md');
    expect(relative('', 'AI/Ollama.md')).toBe('AI/Ollama.md');
    expect(relative('AI', 'AI/LLM/Ollama.md')).toBe('LLM/Ollama.md');
  });
});

describe('HTML のリンク抽出', () => {
  it('href を書いてある場所からの相対として解決する', () => {
    const refs = parseHtmlLinks('web/page.html', '<a href="../AI/Ollama.md">Ollama</a>');
    expect(refs).toHaveLength(1);
    expect(refs[0]?.target).toBe('AI/Ollama.md');
    expect(refs[0]?.embed).toBe(false);
  });

  it('先頭が / なら Vault のルートから', () => {
    const refs = parseHtmlLinks('web/deep/page.html', '<a href="/AI/Ollama.md">x</a>');
    expect(refs[0]?.target).toBe('AI/Ollama.md');
  });

  it('外部・ページ内・データ URL は拾わない', () => {
    const html = [
      '<a href="https://example.com">外部</a>',
      '<a href="//example.com">スキーム相対</a>',
      '<a href="mailto:a@example.com">メール</a>',
      '<a href="#section">ページ内</a>',
      '<a href="">空</a>',
    ].join('');
    expect(parseHtmlLinks('page.html', html)).toEqual([]);
  });

  it('#見出し と ?query を分けて持つ', () => {
    const refs = parseHtmlLinks('page.html', '<a href="note.md?v=1#見出し">x</a>');
    expect(refs[0]?.target).toBe('note.md');
    expect(refs[0]?.subpath).toBe('#見出し');
  });

  it('img は埋め込みとして数える', () => {
    const meta = scanDocument('web/page.html', '<img src="../img/logo.png"><a href="a.md">x</a>', stat);
    expect(meta.embeds.map((ref) => ref.target)).toEqual(['img/logo.png']);
    expect(meta.links.map((ref) => ref.target)).toEqual(['web/a.md']);
  });

  it('from / to は URL の文字だけを指す', () => {
    const html = '<a class="x" href="note.md">x</a>';
    const ref = parseHtmlLinks('page.html', html)[0]!;
    expect(html.slice(ref.from, ref.to)).toBe('note.md');
  });
});

describe('HTML が孤立しないこと', () => {
  async function setup(): Promise<{ adapter: MemoryAdapter; vault: VaultService; index: Indexer }> {
    const adapter = new MemoryAdapter('HTML links');
    await adapter.write('AI/Ollama.md', '# Ollama');
    await adapter.write('web/page.html', '<a href="../AI/Ollama.md">Ollama</a><a href="../missing.md">無い</a>');
    const vault = new VaultService(adapter, { mtimeToleranceMs: 0 });
    const index = new Indexer(vault);
    await index.rebuild();
    return { adapter, vault, index };
  }

  it('HTML からのリンクがバックリンクに出る', async () => {
    const { index } = await setup();
    const backlinks = index.backlinks('AI/Ollama.md');
    expect(backlinks.map((backlink) => backlink.from)).toEqual(['web/page.html']);
  });

  it('HTML の届かないリンクは未解決に出る', async () => {
    const { index } = await setup();
    expect(index.unresolved().map((group) => group.name)).toContain('missing.md');
  });

  it('拡張子つきでも解決する（byPath の鍵と揃える）', async () => {
    const { index } = await setup();
    expect(index.resolve('web/page.html', 'AI/Ollama.md')).toBe('web/page.html');
    expect(index.resolve('web/page', 'AI/Ollama.md')).toBe('web/page.html');
  });

  it('改名すると HTML の href も相対のまま追従する', async () => {
    const { adapter, vault, index } = await setup();
    const plan = await planRename(vault, index, 'AI/Ollama.md', 'AI/LLM/Llama.md');

    expect(plan.occurrenceCount).toBe(1);
    await applyRenamePlan(vault, plan);

    const html = await adapter.read('web/page.html');
    expect(html).toContain('href="../AI/LLM/Llama.md"');
    // 他の属性やタグは触らない。
    expect(html).toContain('<a href="../missing.md">無い</a>');
  });
});
