import { describe, expect, it } from 'vitest';
import {
  basename,
  dirname,
  extname,
  isAncestor,
  isHidden,
  isHtml,
  isMarkdown,
  isSupportedDocument,
  join,
  normalize,
  segments,
} from '../src/core/vault/path';

describe('path', () => {
  it('normalize がスラッシュを正規化する', () => {
    expect(normalize('/a//b/')).toBe('a/b');
    expect(normalize('a/./b')).toBe('a/b');
    expect(normalize('a/b/../c')).toBe('a/c');
    expect(normalize('')).toBe('');
  });

  it('normalize がルートを超えて遡らない', () => {
    expect(normalize('../../etc/passwd')).toBe('etc/passwd');
  });

  it('join / segments', () => {
    expect(join('AI', 'Ollama.md')).toBe('AI/Ollama.md');
    expect(segments('AI/Ollama.md')).toEqual(['AI', 'Ollama.md']);
    expect(segments('')).toEqual([]);
  });

  it('dirname / basename / extname', () => {
    expect(dirname('AI/Ollama.md')).toBe('AI');
    expect(dirname('Ollama.md')).toBe('');
    expect(basename('AI/Ollama.md')).toBe('Ollama.md');
    expect(basename('AI/Ollama.md', true)).toBe('Ollama');
    expect(extname('AI/Ollama.md')).toBe('.md');
    expect(extname('README')).toBe('');
    expect(extname('.gitignore')).toBe('');
  });

  it('対応ドキュメント / isHidden / isAncestor', () => {
    expect(isMarkdown('a/b.MD')).toBe(true);
    expect(isMarkdown('a/b.png')).toBe(false);
    expect(isHtml('web/index.HTML')).toBe(true);
    expect(isHtml('web/legacy.HTM')).toBe(true);
    expect(isSupportedDocument('web/index.html')).toBe(true);
    expect(isSupportedDocument('image.png')).toBe(false);
    expect(isHidden('.shiorbit/cache/x.json')).toBe(true);
    expect(isHidden('AI/Ollama.md')).toBe(false);
    expect(isAncestor('AI', 'AI/Ollama.md')).toBe(true);
    expect(isAncestor('AI', 'AIX/Ollama.md')).toBe(false);
    expect(isAncestor('', 'Ollama.md')).toBe(true);
  });
});
