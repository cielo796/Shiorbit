import { describe, expect, it } from 'vitest';
import {
  invalidNameReason,
  newDocumentBody,
  resolveNewDocument,
} from '../src/core/notes/newDocument';

describe('新規作成のパス解決', () => {
  it('拡張子が無ければ選んだ種別の拡張子を付ける', () => {
    expect(resolveNewDocument('Ollama', 'markdown', '')).toEqual({ path: 'Ollama.md', kind: 'markdown' });
    expect(resolveNewDocument('Ollama', 'html', '')).toEqual({ path: 'Ollama.html', kind: 'html' });
  });

  it('入力の拡張子は選択より優先される', () => {
    expect(resolveNewDocument('page.html', 'markdown', '')).toEqual({ path: 'page.html', kind: 'html' });
    expect(resolveNewDocument('note.md', 'html', '')).toEqual({ path: 'note.md', kind: 'markdown' });
    expect(resolveNewDocument('old.htm', 'markdown', '')).toEqual({ path: 'old.htm', kind: 'html' });
  });

  it('作成先フォルダからの相対として解決する', () => {
    expect(resolveNewDocument('Ollama', 'markdown', 'AI')).toEqual({ path: 'AI/Ollama.md', kind: 'markdown' });
    expect(resolveNewDocument('LLM/Ollama', 'markdown', 'AI')).toEqual({
      path: 'AI/LLM/Ollama.md',
      kind: 'markdown',
    });
  });

  it('フォルダは拡張子を付けずにそのまま返す', () => {
    expect(resolveNewDocument('AI/LLM', 'folder', '')).toEqual({ path: 'AI/LLM', kind: 'folder' });
  });

  it('空・空白だけ・ルートを越える入力は作成しない', () => {
    expect(resolveNewDocument('', 'markdown', '')).toBeNull();
    expect(resolveNewDocument('   ', 'markdown', '')).toBeNull();
    expect(resolveNewDocument('..', 'markdown', '')).toBeNull();
  });
});

describe('新規作成の入力検査', () => {
  it('ファイル名に使えない文字を拒む', () => {
    expect(invalidNameReason('a:b')).not.toBeNull();
    expect(invalidNameReason('a?b')).not.toBeNull();
    expect(invalidNameReason('AI/Ollama')).toBeNull();
  });

  it('対応しない拡張子を拒む', () => {
    expect(invalidNameReason('script.js')).not.toBeNull();
    expect(invalidNameReason('note.md')).toBeNull();
    expect(invalidNameReason('page.html')).toBeNull();
  });

  it('空の入力は理由なし（作成ボタンを無効にするだけ）', () => {
    expect(invalidNameReason('')).toBeNull();
  });
});

describe('新規作成の初期内容', () => {
  it('Markdown は見出しから始まる', () => {
    expect(newDocumentBody('markdown', 'Ollama')).toBe('# Ollama\n\n');
  });

  it('HTML は最小の雛形になり、題名はエスケープされる', () => {
    const body = newDocumentBody('html', 'A & B');
    expect(body).toContain('<!doctype html>');
    expect(body).toContain('<title>A &amp; B</title>');
    expect(body).toContain('<h1>A &amp; B</h1>');
    expect(body).not.toContain('A & B');
  });
});
