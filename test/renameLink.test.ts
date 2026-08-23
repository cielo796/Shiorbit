import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryAdapter } from '../src/adapters/memory';
import { Indexer } from '../src/core/index/Indexer';
import { parseLinks } from '../src/core/markdown/wikilink';
import { applyRenamePlan, planRename } from '../src/core/refactor/planRename';
import { renameResolvedLinks } from '../src/core/refactor/renameLink';
import { VaultService } from '../src/core/vault/VaultService';

describe('renameResolvedLinks', () => {
  it('basename・パス・別名・サブパスの表記を保つ', () => {
    const source = [
      '[[Ollama]]',
      '[[AI/Ollama]]',
      '[[Ollama|オラマ]]',
      '[[Ollama#使い方]]',
      '![[Ollama#概要|埋め込み]]',
    ].join(' ');
    const result = renameResolvedLinks(source, parseLinks(source), 'Research/Llama.md');
    expect(result.text).toBe([
      '[[Llama]]',
      '[[Research/Llama]]',
      '[[Llama|オラマ]]',
      '[[Llama#使い方]]',
      '![[Llama#概要|埋め込み]]',
    ].join(' '));
    expect(result.rewrites).toHaveLength(5);
  });

  it('コードブロックとインラインコード内は書き換えない', () => {
    const source = '[[Ollama]]\n```\n[[Ollama]]\n```\n`[[Ollama]]`';
    const result = renameResolvedLinks(source, parseLinks(source), 'Llama.md');
    expect(result.text).toBe('[[Llama]]\n```\n[[Ollama]]\n```\n`[[Ollama]]`');
    expect(result.rewrites).toHaveLength(1);
  });

  it('Markdownリンクでもラベルと明示拡張子を保つ', () => {
    const source = '[説明](AI/Ollama.md#使い方) ![画像](Ollama.md)';
    const result = renameResolvedLinks(source, parseLinks(source), 'Research/Llama.md');
    expect(result.text).toBe('[説明](Research/Llama.md#使い方) ![画像](Llama.md)');
  });
});

describe('planRename', () => {
  let adapter: MemoryAdapter;
  let vault: VaultService;
  let index: Indexer;

  beforeEach(async () => {
    adapter = new MemoryAdapter('Rename');
    vault = new VaultService(adapter, { mtimeToleranceMs: 0 });
    index = new Indexer(vault);
    await adapter.write('AI/Ollama.md', '# Ollama\n[[Ollama]]');
    await adapter.write('AI/Guide.md', '[[Ollama]] [[AI/Ollama|名前]]');
    await adapter.write('Other/Ollama.md', '# 同名');
    await adapter.write('Other/Guide.md', '[[Ollama]]');
    await index.rebuild();
  });

  it('実際に対象へ解決されるリンクだけを計画し、改名後も未解決にしない', async () => {
    const plan = await planRename(vault, index, 'AI/Ollama.md', 'AI/Llama.md');
    expect(plan.files.map((file) => file.path)).toEqual(['AI/Guide.md', 'AI/Ollama.md']);
    expect(plan.occurrenceCount).toBe(3);

    await applyRenamePlan(vault, plan);
    index.removeNote('AI/Ollama.md');
    await index.updateNote('AI/Llama.md');
    await index.updateNote('AI/Guide.md');

    expect(await adapter.read('AI/Guide.md')).toBe('[[Llama]] [[AI/Llama|名前]]');
    expect(await adapter.read('Other/Guide.md')).toBe('[[Ollama]]');
    expect(index.unresolved()).toEqual([]);
  });

  it('改名に失敗した場合は先に書き換えた参照元を元へ戻す', async () => {
    const plan = await planRename(vault, index, 'AI/Ollama.md', 'AI/Llama.md');
    await adapter.write('AI/Llama.md', '# 既存');

    await expect(applyRenamePlan(vault, plan)).rejects.toThrow();
    expect(await adapter.read('AI/Guide.md')).toBe('[[Ollama]] [[AI/Ollama|名前]]');
    expect(await adapter.exists('AI/Ollama.md')).toBe(true);
  });
});
