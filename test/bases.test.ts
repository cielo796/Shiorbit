import { describe, expect, it } from 'vitest';
import { defaultBase, parseBase, stringifyBase } from '../src/core/bases/parse';
import { columnLabel, formatValue, propertyOf, runQuery } from '../src/core/bases/query';
import type { NoteMeta } from '../src/core/markdown/scan';

function note(path: string, frontmatter: Record<string, unknown>, extra: Partial<NoteMeta> = {}): NoteMeta {
  return {
    path,
    basename: path.split('/').pop()!.replace(/\.md$/, ''),
    mtime: 1,
    size: 10,
    frontmatter,
    headings: [],
    blockIds: [],
    links: [],
    embeds: [],
    tags: [],
    ...extra,
  };
}

const SAMPLE = [
  'name: 読書リスト',
  'from:',
  '  folder: Books',
  '  tags: [book]',
  'where:',
  '  - property: status',
  '    op: equals',
  '    value: 読了',
  'columns:',
  '  - property: file.name',
  '    label: タイトル',
  '  - property: author',
  'sort:',
  '  property: rating',
  '  order: desc',
].join('\n');

describe('.base の読み込み', () => {
  it('入れ子・マップの配列・インライン配列を読む', () => {
    const base = parseBase(SAMPLE);
    expect(base.name).toBe('読書リスト');
    expect(base.from).toEqual({ folder: 'Books', tags: ['book'] });
    expect(base.where).toEqual([{ property: 'status', op: 'equals', value: '読了' }]);
    expect(base.columns).toEqual([
      { property: 'file.name', label: 'タイトル' },
      { property: 'author' },
    ]);
    expect(base.sort).toEqual({ property: 'rating', order: 'desc' });
  });

  it('書き戻して読み直しても同じ意味になる', () => {
    const base = parseBase(SAMPLE);
    expect(parseBase(stringifyBase(base))).toEqual(base);
    expect(parseBase(stringifyBase(defaultBase('T')))).toEqual(defaultBase('T'));
  });

  it('壊れていても落ちず、読める分だけ拾う', () => {
    const broken = parseBase('name: X\nwhere:\n  - これは項目ではない\ncolumns:\n  - property: a\n  ???\n');
    expect(broken.name).toBe('X');
    expect(broken.where).toEqual([]);
    expect(broken.columns).toEqual([{ property: 'a' }]);

    expect(parseBase('').columns).toEqual([]);
    expect(parseBase('[[[').name).toBe('');
    expect(parseBase('- 1\n- 2').name).toBe('');
  });

  it('知らない演算子の条件は捨てる', () => {
    const base = parseBase('where:\n  - property: a\n    op: explode\n  - property: b\n    op: gt\n    value: 3\n');
    expect(base.where).toEqual([{ property: 'b', op: 'gt', value: 3 }]);
  });

  it('列は文字列だけでも書ける', () => {
    expect(parseBase('columns:\n  - author\n  - rating\n').columns).toEqual([
      { property: 'author' },
      { property: 'rating' },
    ]);
  });
});

describe('.base の問い合わせ', () => {
  const notes = [
    note('Books/A.md', { status: '読了', author: '井上', rating: 5 }, { tags: ['book'] }),
    note('Books/B.md', { status: '読了', author: '中村', rating: 3 }, { tags: ['book'] }),
    note('Books/C.md', { status: '未読', author: '井上' }, { tags: ['book'] }),
    note('Notes/D.md', { status: '読了', author: '外', rating: 9 }, { tags: ['note'] }),
  ];

  it('folder と tags で対象を絞る', () => {
    const base = parseBase(SAMPLE);
    const rows = runQuery(base, notes);
    expect(rows.map((row) => row.path)).toEqual(['Books/A.md', 'Books/B.md']);
  });

  it('sort の向きで並びが変わる', () => {
    const desc = runQuery(parseBase(SAMPLE), notes).map((row) => row.path);
    const asc = runQuery({ ...parseBase(SAMPLE), sort: { property: 'rating', order: 'asc' } }, notes)
      .map((row) => row.path);
    expect(desc).toEqual(['Books/A.md', 'Books/B.md']);
    expect(asc).toEqual(['Books/B.md', 'Books/A.md']);
  });

  it('値が無い行は、昇順でも降順でも最後に来る', () => {
    const base = {
      ...parseBase('columns:\n  - property: rating\n'),
      sort: { property: 'rating', order: 'desc' as const },
    };
    const rows = runQuery(base, notes);
    expect(rows[rows.length - 1]?.path).toBe('Books/C.md');
  });

  it('各演算子が効く', () => {
    const run = (where: string): string[] =>
      runQuery(parseBase(`columns:\n  - property: file.name\n${where}`), notes).map((r) => r.path);

    expect(run('where:\n  - property: status\n    op: equals\n    value: 未読\n')).toEqual(['Books/C.md']);
    expect(run('where:\n  - property: status\n    op: not\n    value: 読了\n')).toEqual(['Books/C.md']);
    expect(run('where:\n  - property: author\n    op: contains\n    value: 井\n'))
      .toEqual(['Books/A.md', 'Books/C.md']);
    expect(run('where:\n  - property: rating\n    op: exists\n')).toEqual(['Books/A.md', 'Books/B.md', 'Notes/D.md']);
    expect(run('where:\n  - property: rating\n    op: gt\n    value: 4\n')).toEqual(['Books/A.md', 'Notes/D.md']);
    expect(run('where:\n  - property: rating\n    op: lt\n    value: 4\n')).toEqual(['Books/B.md']);
  });

  it('条件をすべて満たす行だけを残す', () => {
    const rows = runQuery(
      parseBase([
        'columns:',
        '  - property: file.name',
        'where:',
        '  - property: author',
        '    op: contains',
        '    value: 井上',
        '  - property: rating',
        '    op: exists',
      ].join('\n')),
      notes,
    );
    expect(rows.map((row) => row.path)).toEqual(['Books/A.md']);
  });

  it('配列のプロパティは、どれか1つ一致すればよい', () => {
    const tagged = [note('X.md', { genre: ['SF', '技術書'] })];
    const rows = runQuery(
      parseBase('columns:\n  - property: genre\nwhere:\n  - property: genre\n    op: equals\n    value: SF\n'),
      tagged,
    );
    expect(rows).toHaveLength(1);
  });

  it('組み込みプロパティを読む', () => {
    const meta = note('AI/Ollama.md', { author: '本人' }, { mtime: 1700000000000, size: 2048, tags: ['ai'] });
    expect(propertyOf(meta, 'file.name')).toBe('Ollama');
    expect(propertyOf(meta, 'file.path')).toBe('AI/Ollama.md');
    expect(propertyOf(meta, 'file.size')).toBe(2048);
    expect(propertyOf(meta, 'file.tags')).toEqual(['ai']);
    // frontmatter より組み込みが優先される。
    expect(propertyOf({ ...meta, frontmatter: { 'file.name': '偽' } }, 'file.name')).toBe('Ollama');
  });

  it('未設定のプロパティは空欄になる（エラーにしない）', () => {
    const rows = runQuery(parseBase('columns:\n  - property: 無い\n'), [note('A.md', {})]);
    expect(rows[0]?.cells).toEqual([null]);
    expect(formatValue('無い', rows[0]!.cells[0]!)).toBe('');
  });

  it('表示の整形', () => {
    expect(formatValue('file.size', 512)).toBe('512 B');
    expect(formatValue('file.size', 2048)).toBe('2 KB');
    expect(formatValue('file.tags', ['a', 'b'])).toBe('a, b');
    expect(columnLabel('file.mtime')).toBe('更新');
    expect(columnLabel('author', '著者')).toBe('著者');
    expect(columnLabel('author')).toBe('author');
  });
});
