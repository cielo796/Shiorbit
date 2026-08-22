import { describe, expect, it } from 'vitest';
import { maskCode } from '../src/core/markdown/code';
import { formatWikilink, linkDisplay, parseLinks } from '../src/core/markdown/wikilink';
import { parseFrontmatter } from '../src/core/markdown/frontmatter';
import { aliasesOf, displayTitle, extractContext, scanNote } from '../src/core/markdown/scan';

const stat = { mtime: 1000, size: 0 };

describe('maskCode', () => {
  it('フェンスコードブロックを消す (長さは保つ)', () => {
    const src = 'a\n```\n[[Secret]]\n```\nb';
    const masked = maskCode(src);
    expect(masked.length).toBe(src.length);
    expect(masked).not.toContain('[[Secret]]');
    expect(masked.startsWith('a\n')).toBe(true);
    expect(masked.endsWith('\nb')).toBe(true);
  });

  it('インラインコードを消す', () => {
    expect(maskCode('見て `[[X]]` ね')).not.toContain('[[X]]');
  });

  it('エスケープを無効化する', () => {
    expect(maskCode('\\[[X]]')).not.toContain('[[X]]');
  });
});

describe('parseLinks', () => {
  it('基本の [[Foo]]', () => {
    const [ref] = parseLinks('本文 [[LocalLLM]] です');
    expect(ref).toMatchObject({ target: 'LocalLLM', embed: false });
    expect(ref!.alias).toBeUndefined();
    expect(ref!.subpath).toBeUndefined();
  });

  it('別名・見出し・ブロックID', () => {
    const refs = parseLinks('[[A|表示名]] [[B#見出し]] [[C#^abc123]] [[D#見出し|別名]]');
    expect(refs.map((r) => r.target)).toEqual(['A', 'B', 'C', 'D']);
    expect(refs[0]!.alias).toBe('表示名');
    expect(refs[1]!.subpath).toBe('#見出し');
    expect(refs[2]!.subpath).toBe('#^abc123');
    expect(refs[3]).toMatchObject({ subpath: '#見出し', alias: '別名' });
  });

  it('埋め込み ![[...]] を区別する', () => {
    const refs = parseLinks('![[image.png]] と [[Note]]');
    expect(refs[0]!.embed).toBe(true);
    expect(refs[1]!.embed).toBe(false);
  });

  it('フォルダ付きパスと .md を正規化する', () => {
    const [ref] = parseLinks('[[AI/Ollama.md]]');
    expect(ref!.target).toBe('AI/Ollama');
  });

  it('オフセットが元テキストを指す', () => {
    const text = 'あいう [[X]] えお';
    const [ref] = parseLinks(text);
    expect(text.slice(ref!.from, ref!.to)).toBe('[[X]]');
  });

  it('コード内のリンクは拾わない', () => {
    expect(parseLinks('```\n[[NG]]\n```\n[[OK]]').map((r) => r.target)).toEqual(['OK']);
  });

  it('内部 Markdown リンクは拾い、外部 URL は無視する', () => {
    const refs = parseLinks('[ラベル](AI/Ollama.md) と [外部](https://example.com)');
    expect(refs.map((r) => r.target)).toEqual(['AI/Ollama']);
    expect(refs[0]!.alias).toBe('ラベル');
  });

  it('空リンクや [[]] は無視する', () => {
    expect(parseLinks('[[]] [[   ]]')).toEqual([]);
  });

  it('linkDisplay / formatWikilink', () => {
    const [a, b] = parseLinks('[[X|別名]] [[Y#見出し]]');
    expect(linkDisplay(a!)).toBe('別名');
    expect(linkDisplay(b!)).toBe('Y#見出し');
    expect(formatWikilink('AI/Ollama')).toBe('[[AI/Ollama]]');
    expect(formatWikilink('AI/Ollama', 'オラマ')).toBe('[[AI/Ollama|オラマ]]');
  });
});

describe('parseFrontmatter', () => {
  it('スカラー・インライン配列・ブロック配列', () => {
    const { data, bodyStart } = parseFrontmatter(
      ['---', 'title: Ollama', 'tags: [ai, llm]', 'aliases:', '  - オラマ', '  - ollama', 'draft: true', 'rank: 3', '---', '# 本文'].join('\n'),
    );
    expect(data['title']).toBe('Ollama');
    expect(data['tags']).toEqual(['ai', 'llm']);
    expect(data['aliases']).toEqual(['オラマ', 'ollama']);
    expect(data['draft']).toBe(true);
    expect(data['rank']).toBe(3);
    expect(bodyStart).toBeGreaterThan(0);
  });

  it('frontmatter が無ければ空', () => {
    expect(parseFrontmatter('# 見出し')).toEqual({ data: {}, bodyStart: 0 });
  });
});

describe('scanNote', () => {
  it('見出し・タグ・ブロックID・リンクを抽出する', () => {
    const text = [
      '---',
      'tags: [ai]',
      '---',
      '# Ollama',
      '',
      '#ローカルLLM の実行環境。 [[LocalLLM]] を参照。',
      '',
      '## 使い方',
      'これは重要な段落 ^important',
      '',
      '```',
      '# これは見出しではない',
      '#notatag',
      '```',
    ].join('\n');

    const meta = scanNote('AI/Ollama.md', text, stat);
    expect(meta.basename).toBe('Ollama');
    expect(meta.headings.map((h) => h.text)).toEqual(['Ollama', '使い方']);
    expect(meta.headings[0]!.level).toBe(1);
    expect(meta.blockIds).toEqual(['important']);
    expect(meta.links.map((l) => l.target)).toEqual(['LocalLLM']);
    expect(meta.tags.sort()).toEqual(['ai', 'ローカルLLM']);
  });

  it('見出しの # をタグと誤認しない', () => {
    const meta = scanNote('a.md', '# 見出し\n## 小見出し\n', stat);
    expect(meta.tags).toEqual([]);
  });

  it('displayTitle は title > H1 > ファイル名の順', () => {
    expect(displayTitle(scanNote('a.md', '---\ntitle: T\n---\n# H\n', stat))).toBe('T');
    expect(displayTitle(scanNote('a.md', '# H\n', stat))).toBe('H');
    expect(displayTitle(scanNote('dir/a.md', '本文', stat))).toBe('a');
  });

  it('aliasesOf が別名を返す', () => {
    expect(aliasesOf(scanNote('a.md', '---\naliases: [X, Y]\n---\n', stat))).toEqual(['X', 'Y']);
    expect(aliasesOf(scanNote('a.md', '本文', stat))).toEqual([]);
  });

  it('extractContext がリンクのある行を返す', () => {
    const text = '一行目\n二行目に [[X]] がある\n三行目';
    const [ref] = parseLinks(text);
    expect(extractContext(text, ref!.from, ref!.to)).toBe('二行目に [[X]] がある');
  });
});
