import { describe, expect, it, vi } from 'vitest';
import { MemoryAdapter } from '../src/adapters/memory';
import { MemoryKeyValueStore } from '../src/adapters/memoryKv';
import { VaultService } from '../src/core/vault/VaultService';
import { Indexer } from '../src/core/index/Indexer';
import { Settings, SETTINGS_PATH, normalize } from '../src/core/settings/Settings';
import { editManualTags, normalizeTag } from '../src/core/notes/tags';
import { scanNote } from '../src/core/markdown/scan';

const change = (text: string, tags: string[]): string => {
  const edit = editManualTags(text, tags);
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
};

describe('手動タグの編集', () => {
  it('frontmatter を追加しても本文は一文字も変わらない', () => {
    const body = '# 本文\n\n#自動 `#コード`\n';
    const result = change(body, ['#ゲーム/BF6', '手動', '手動', '123']);
    expect(result).toBe('---\ntags: ["ゲーム/BF6", "手動", "123"]\n---\n' + body);
    expect(scanNote('a.md', result, { mtime: 0, size: 0 }).tags).toEqual(['自動', 'ゲーム/BF6', '手動', '123']);
  });
  it('他のプロパティ・コメント・CRLFと本文を保存する', () => {
    const body = '---\r\ntitle: テスト\r\ntags:\r\n  - one\r\n  - "two"\r\n# 説明\r\nflag: true\r\ntag: three\r\n---\r\n本文\r\n';
    expect(change(body, ['新規'])).toBe('---\r\ntitle: テスト\r\n# 説明\r\nflag: true\r\ntags: ["新規"]\r\n---\r\n本文\r\n');
  });
  it('全て削除しても本文の自動タグは消さない', () => {
    expect(change('---\ntags: [one]\n---\n#one', [])).toBe('---\ntags: []\n---\n#one');
    expect(change('本文だけ', [])).toBe('本文だけ');
  });
  it('空の frontmatter と終端に改行のない frontmatter を扱う', () => {
    expect(change('---\n---\n本文', ['a'])).toBe('---\ntags: ["a"]\n---\n本文');
    expect(change('---\ntitle: T\n---', ['a'])).toBe('---\ntitle: T\ntags: ["a"]\n---');
  });
  it.each(['tags: &ref [a]', 'tags: {a: b}', 'tags: [a] # comment', 'tags: |\n  multi', 'tags:\n  child: value', 'tags: [1, true]', 'tags: a\ntags: b', '"tags": [a]', '<<: *common', 'tags:\n# comment\n  - hidden'])('解釈できない値を黙って上書きしない: %s', (header) => {
    expect(() => change(`---\n${header}\n---\n本文`, ['b'])).toThrow();
  });
  it('閉じていない frontmatter と不正な新規タグを拒否する', () => {
    expect(() => change('---\ntitle: T\n本文', ['a'])).toThrow();
    for (const tag of ['', '#', 'a b', 'a,b', 'a\nb', '<script>']) expect(() => normalizeTag(tag)).toThrow();
  });
});

describe('設定によるタグ収集の切替', () => {
  it('未設定・壊れた設定は従来どおりON、booleanだけを受け付ける', () => {
    expect(normalize({}).autoCollectTags).toBe(true);
    expect(normalize({ autoCollectTags: 'false' }).autoCollectTags).toBe(true);
    expect(normalize({ autoCollectTags: false }).autoCollectTags).toBe(false);
  });
  it('OFFを永続化し、プレビューの取消でも保存済み状態を維持する', async () => {
    const adapter = new MemoryAdapter('tags');
    const vault = new VaultService(adapter);
    const settings = new Settings(vault);
    await settings.load();
    settings.preview({ autoCollectTags: false });
    expect(await adapter.exists(SETTINGS_PATH)).toBe(false);
    settings.discardPreview();
    expect(settings.data.autoCollectTags).toBe(true);
    await settings.update({ autoCollectTags: false });
    const restored = new Settings(vault);
    await restored.load();
    expect(restored.data.autoCollectTags).toBe(false);
    restored.preview({ autoCollectTags: true });
    restored.discardPreview();
    expect(restored.data.autoCollectTags).toBe(false);
  });
  it('保存に失敗した値を保存済みとして扱わない', async () => {
    const vault = new VaultService(new MemoryAdapter('tags'));
    const settings = new Settings(vault);
    await settings.load();
    vi.spyOn(vault, 'writeNote').mockRejectedValue(new Error('書き込み不可'));
    settings.preview({ autoCollectTags: false });
    await expect(settings.update({ autoCollectTags: false })).rejects.toThrow('書き込み不可');
    settings.discardPreview();
    expect(settings.data.autoCollectTags).toBe(true);
  });
  it('保存を待たず連続変更しても表示は即時で、最後の設定がディスクに残る', async () => {
    const adapter = new MemoryAdapter('tags');
    const vault = new VaultService(adapter);
    const settings = new Settings(vault);
    await settings.load();
    const first = settings.update({ autoCollectTags: false });
    expect(settings.data.autoCollectTags).toBe(false);
    const second = settings.update({ zoom: 1.2 });
    expect(settings.data.zoom).toBe(1.2);
    expect(settings.data.autoCollectTags).toBe(false);
    await Promise.all([first, second]);
    expect(JSON.parse(await adapter.read(SETTINGS_PATH))).toMatchObject({ autoCollectTags: false, zoom: 1.2 });
    settings.preview({ autoCollectTags: true });
    settings.discardPreview();
    expect(settings.data.autoCollectTags).toBe(false);
  });
  it('OFFは一覧・個別メタ・Bases・検索加点に反映され、手動タグと本文は残る', async () => {
    const adapter = new MemoryAdapter('tags');
    const source = '---\ntags: [manual, shared]\ntag: legacy\n---\n#auto #shared\n';
    await adapter.write('a.md', source);
    await adapter.write('b.html', '<p>#html</p>');
    const vault = new VaultService(adapter);
    const index = new Indexer(vault);
    await index.rebuild();
    const notify = vi.fn();
    index.onChange(notify);
    const score = (await index.searchNotes('auto'))[0]!.score;
    index.setAutoCollectTags(false);
    expect(notify).toHaveBeenCalledTimes(1);
    expect([...index.tags().keys()]).toEqual(['manual', 'shared', 'legacy']);
    expect(index.getMeta('a.md')!.tags).toEqual(['manual', 'shared', 'legacy']);
    expect(index.allMeta().find((meta) => meta.path === 'a.md')!.tags).toEqual(['manual', 'shared', 'legacy']);
    expect((await index.searchNotes('auto'))[0]!.score).toBeLessThan(score);
    expect(await adapter.read('a.md')).toBe(source);
    index.setAutoCollectTags(true);
    expect(index.tags().has('auto')).toBe(true);
    index.dispose();
    vault.dispose();
  });
  it('OFFのまま保存・強制再走査・キャッシュ復元を経ても自動タグは混ざらない', async () => {
    const adapter = new MemoryAdapter('tags');
    const vault = new VaultService(adapter);
    const cache = new MemoryKeyValueStore();
    await adapter.write('a.md', '---\ntags: [manual]\n---\n#auto');
    const first = new Indexer(vault, { cache });
    await first.rebuild();
    await first.flush();
    first.dispose();
    const second = new Indexer(vault, { cache, autoCollectTags: false });
    await second.rebuild();
    expect(second.report.reused).toBe(1);
    expect([...second.tags().keys()]).toEqual(['manual']);
    await adapter.write('a.md', '---\ntags: [edited]\n---\n#newauto');
    await second.updateNote('a.md');
    expect([...second.tags().keys()]).toEqual(['edited']);
    await second.rebuild(undefined, true);
    expect([...second.tags().keys()]).toEqual(['edited']);
    await second.flush();
    second.dispose();
    const third = new Indexer(vault, { cache });
    await third.rebuild();
    expect(third.report.reused).toBe(1);
    expect([...third.tags().keys()]).toEqual(['newauto', 'edited']);
    expect((await third.searchNotes('newauto'))[0]?.path).toBe('a.md');
    third.dispose();
    vault.dispose();
  });
});
