import { describe, expect, it, vi } from 'vitest';
import { MarkdownImporter, type IncomingMarkdown } from '../src/core/notes/MarkdownImporter';
import { MemoryAdapter } from '../src/adapters/memory';
import { VaultService } from '../src/core/vault/VaultService';

function source(name: string, text = '# 日本語\r\n'): IncomingMarkdown {
  return { name, kind: 'file', readText: vi.fn(async () => text) };
}
function setup() {
  const adapter = new MemoryAdapter('Import');
  const vault = new VaultService(adapter);
  return { adapter, vault, importer: new MarkdownImporter(vault) };
}

describe('Markdown / HTML の取り込み', () => {
  it('指定フォルダにMDとHTMLを保存し、BOM・日本語・改行・空ファイルを保持する', async () => {
    const { adapter, importer } = setup();
    await adapter.mkdir('Projects/Notes');
    const result = await importer.import('Projects/Notes', [
      source('日本語.md', '\ufeff# 日本語\r\n'), source('Page.HTML', '<h1>日本語</h1>\r\n'), source('Empty.MD', ''),
    ]);
    expect(result).toEqual({
      imported: ['Projects/Notes/日本語.md', 'Projects/Notes/Page.HTML', 'Projects/Notes/Empty.MD'],
      skipped: [], failed: [],
    });
    expect(await adapter.read('Projects/Notes/日本語.md')).toBe('\ufeff# 日本語\r\n');
    expect(await adapter.read('Projects/Notes/Page.HTML')).toBe('<h1>日本語</h1>\r\n');
    expect(await adapter.read('Projects/Notes/Empty.MD')).toBe('');
    expect(await adapter.exists('日本語.md')).toBe(false);
  });

  it('空の保存先はルートとし、同名・大文字小文字違い・同名フォルダを上書きしない', async () => {
    const { adapter, importer } = setup();
    await adapter.write('Taken.md', '既存');
    await adapter.mkdir('Folder.md');
    const inputs = [source('taken.MD'), source('Folder.md'), source('New.md'), source('New.md')];
    const result = await importer.import('', inputs);
    expect(result.imported).toEqual(['New.md']);
    expect(result.skipped).toHaveLength(3);
    expect(await adapter.read('Taken.md')).toBe('既存');
    expect(inputs[0]!.readText).not.toHaveBeenCalled();
    expect(inputs[1]!.readText).not.toHaveBeenCalled();
    expect(inputs[3]!.readText).not.toHaveBeenCalled();
  });

  it.each(['image.png', 'page.txt', 'data.base', '.hidden.md', '../escape.md', 'folder/note.md', 'a\\b.md', 'CON.md', 'a:stream.md', 'bad\u0000.md'])
   ('%s は読み込まずスキップする', async (name) => {
      const { adapter, importer } = setup();
      const input = source(name);
      const result = await importer.import('', [input]);
      expect(result.skipped).toHaveLength(1);
      expect(result.imported).toEqual([]);
      expect(input.readText).not.toHaveBeenCalled();
      expect(await adapter.list('', true)).toEqual([]);
    });

  it('.md という名前でもディレクトリは取り込まない', async () => {
    const { importer } = setup();
    const input = { ...source('Directory.md'), kind: 'directory' as const };
    expect((await importer.import('', [input])).skipped[0]?.reason).toContain('フォルダ');
    expect(input.readText).not.toHaveBeenCalled();
  });

  it('一件の読み込み失敗・保存失敗でもほかのファイルを取り込み、結果を区別する', async () => {
    const { adapter, importer } = setup();
    const write = adapter.write.bind(adapter);
    vi.spyOn(adapter, 'write').mockImplementation((path, text) => path === 'Denied.md' ? Promise.reject(new Error('保存権限なし')) : write(path, text));
    const unreadable = { ...source('Unreadable.md'), readText: async () => { throw new Error('読み込み失敗'); } };
    const result = await importer.import('', [unreadable, source('Denied.md'), source('Good.md')]);
    expect(result.imported).toEqual(['Good.md']);
    expect(result.failed).toEqual([{ name: 'Unreadable.md', reason: '読み込み失敗' }, { name: 'Denied.md', reason: '保存権限なし' }]);
    expect(await adapter.exists('Unreadable.md')).toBe(false);
    expect(await adapter.exists('Denied.md')).toBe(false);
  });

  it('同じファイルを続けてドロップしても取り込みを直列化し、一方だけ保存する', async () => {
    const { adapter, importer } = setup();
    const [first, second] = await Promise.all([importer.import('', [source('a.md', '先')]), importer.import('', [source('a.md', '後')])]);
    expect(first.imported).toEqual(['a.md']);
    expect(second.skipped).toHaveLength(1);
    expect(await adapter.read('a.md')).toBe('先');
  });

  it('同名ファイルを一覧で確認し、許可された場合だけ既存内容を上書きする', async () => {
    const { adapter, importer } = setup();
    await adapter.write('Taken.md', '既存MD');
    await adapter.write('Page.html', '既存HTML');
    const confirm = vi.fn(async (_conflicts: readonly unknown[]) => true);
    const result = await importer.import('', [
      source('taken.MD', '新しいMD'), source('Page.HTML', '新しいHTML'), source('New.md', '新規'),
    ], () => false, confirm);
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0]?.[0]).toEqual([
      { name: 'taken.MD', path: 'Taken.md' }, { name: 'Page.HTML', path: 'Page.html' },
    ]);
    expect(result.imported).toEqual(['Taken.md', 'Page.html', 'New.md']);
    expect(await adapter.read('Taken.md')).toBe('新しいMD');
    expect(await adapter.read('Page.html')).toBe('新しいHTML');
  });

  it('読み込み中に同名が作られた場合も保存直前の競合チェックで保護する', async () => {
    const { adapter, importer } = setup();
    const input = { ...source('a.md'), readText: async () => { await adapter.write('a.md', '先に保存'); return '取り込み'; } };
    expect((await importer.import('', [input])).failed).toHaveLength(1);
    expect(await adapter.read('a.md')).toBe('先に保存');
  });

  it('保存先が切り替わった場合は、読み込み済みでも書き込まない', async () => {
    const { adapter, importer } = setup();
    let cancelled = false;
    const input = { ...source('a.md'), readText: async () => { cancelled = true; return '# A'; } };
    const second = source('b.md');
    const result = await importer.import('', [input, second], () => cancelled);
    expect(result.skipped).toHaveLength(2);
    expect(await adapter.list('', true)).toEqual([]);
    expect(second.readText).not.toHaveBeenCalled();
  });

  it.each(['Missing', '../escape', '.shiorbit'])('無効な保存先 %s には作らない', async (dir) => {
    const { importer } = setup();
    const input = source('a.md');
    await expect(importer.import(dir, [input])).rejects.toThrow();
    expect(input.readText).not.toHaveBeenCalled();
    // 失敗したバッチが次の取り込みを止めない。
    expect((await importer.import('', [input])).imported).toEqual(['a.md']);
  });
});
