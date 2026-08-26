// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { extractSection } from '../src/core/markdown/section';
import { AttachmentUrlCache, isEmbeddableImage, mimeOf } from '../src/ui/embed/attachmentUrl';

describe('セクションの切り出し', () => {
  const note = [
    '# タイトル',
    '',
    '導入の文。',
    '',
    '## 実行環境',
    '',
    'Ollama を使う。 ^env',
    '',
    '### 補足',
    '',
    '補足の文。',
    '',
    '## 次の節',
    '',
    'ここは含めない。',
  ].join('\n');

  it('見出しから、同じか浅い見出しの直前までを切り出す', () => {
    const section = extractSection(note, '#実行環境');
    expect(section).toContain('## 実行環境');
    expect(section).toContain('Ollama を使う。');
    // 下位の見出しは含み、同レベルの次の見出しは含まない。
    expect(section).toContain('### 補足');
    expect(section).not.toContain('## 次の節');
  });

  it('# の有無と大文字小文字・前後の空白を無視して一致させる', () => {
    expect(extractSection(note, '実行環境')).toBe(extractSection(note, '#実行環境'));
    expect(extractSection('# Ollama\n\n本文', '#  ollama  ')).toContain('本文');
  });

  it('ブロック ID はその段落だけを返し、ID 自体は落とす', () => {
    const block = extractSection(note, '#^env');
    expect(block).toBe('Ollama を使う。');
  });

  it('見つからなければ null', () => {
    expect(extractSection(note, '#無い見出し')).toBeNull();
    expect(extractSection(note, '#^nope')).toBeNull();
    expect(extractSection(note, '#')).toBeNull();
  });

  it('埋め込みの中の埋め込みは展開しない（深さ1で止める）', () => {
    const source = '# A\n\n![[B]]\n';
    // 切り出しはテキストをそのまま返すだけで、中の ![[...]] を辿らない。
    expect(extractSection(source, '#A')).toContain('![[B]]');
  });
});

describe('添付の判定', () => {
  it('対応する画像形式を見分ける', () => {
    expect(isEmbeddableImage('a/b.PNG')).toBe(true);
    expect(isEmbeddableImage('a.svg')).toBe(true);
    expect(isEmbeddableImage('note.md')).toBe(false);
    expect(isEmbeddableImage('noext')).toBe(false);
    expect(mimeOf('x.jpeg')).toBe('image/jpeg');
  });
});

describe('ObjectURL の管理', () => {
  function stubObjectUrl(): { created: string[]; revoked: string[]; restore: () => void } {
    // jsdom は ObjectURL を実装していないので、数えられる形で差し込む。
    const created: string[] = [];
    const revoked: string[] = [];
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    let n = 0;

    URL.createObjectURL = (): string => {
      const url = `blob:test/${n++}`;
      created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url: string): void => {
      revoked.push(url);
    };

    return {
      created,
      revoked,
      restore: () => {
        URL.createObjectURL = original.create;
        URL.revokeObjectURL = original.revoke;
      },
    };
  }

  it('同じパスは読み直さず、同じ URL を返す', async () => {
    const stub = stubObjectUrl();
    const load = vi.fn(() => Promise.resolve(new ArrayBuffer(4)));
    const cache = new AttachmentUrlCache(load);

    const first = await cache.get('img/a.png');
    const second = await cache.get('img/a.png');

    expect(first).toBe(second);
    expect(load).toHaveBeenCalledOnce();
    stub.restore();
  });

  it('上限を超えたら古いものから解放する', async () => {
    const stub = stubObjectUrl();
    const cache = new AttachmentUrlCache(() => Promise.resolve(new ArrayBuffer(4)), 2);

    await cache.get('a.png');
    await cache.get('b.png');
    await cache.get('a.png'); // a を使い直す → 次に捨てられるのは b
    await cache.get('c.png');

    expect(cache.size).toBe(2);
    expect(stub.revoked).toEqual([stub.created[1]]);
    stub.restore();
  });

  it('切り替えを繰り返しても上限を超えて溜まらない', async () => {
    const stub = stubObjectUrl();
    const cache = new AttachmentUrlCache(() => Promise.resolve(new ArrayBuffer(4)), 50);

    for (let i = 0; i < 100; i++) await cache.get(`img/${i}.png`);

    expect(cache.size).toBe(50);
    expect(stub.revoked).toHaveLength(50);
    stub.restore();
  });

  it('clear ですべて解放する', async () => {
    const stub = stubObjectUrl();
    const cache = new AttachmentUrlCache(() => Promise.resolve(new ArrayBuffer(4)));

    await cache.get('a.png');
    await cache.get('b.png');
    cache.clear();

    expect(cache.size).toBe(0);
    expect(stub.revoked).toHaveLength(2);
    stub.restore();
  });

  it('読めなくても例外を投げず null を返す', async () => {
    const stub = stubObjectUrl();
    const cache = new AttachmentUrlCache(() => Promise.reject(new Error('ENOENT')));

    expect(await cache.get('missing.png')).toBeNull();
    expect(await cache.get('note.md')).toBeNull();
    stub.restore();
  });
});
