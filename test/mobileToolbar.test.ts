// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MarkdownEditor } from '../src/ui/editor';
import { MobileToolbar } from '../src/ui/mobileToolbar';

afterEach(() => document.body.replaceChildren());

function editorStub(): MarkdownEditor {
  return {
    insertImageFromComputer: vi.fn(),
    insertHtmlImageFromComputer: vi.fn(),
    wrapSelection: vi.fn(),
    toggleLinePrefix: vi.fn(),
    insertHtmlTable: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
  } as unknown as MarkdownEditor;
}

describe('モバイル記号ツールバー', () => {
  it('MarkdownとHTMLで項目を切り替え、HTMLではMarkdown記号を出さない', () => {
    const editor = editorStub();
    const toolbar = new MobileToolbar({ editor: () => editor });
    document.body.append(toolbar.dom);

    expect(toolbar.dom.dataset.language).toBe('markdown');
    expect(toolbar.dom.textContent).toContain('[[');
    expect([...toolbar.dom.querySelectorAll<HTMLButtonElement>('button')]
      .some((button) => button.title === 'タスク')).toBe(true);

    toolbar.setLanguage('html');
    expect(toolbar.dom.dataset.language).toBe('html');
    expect(toolbar.dom.textContent).not.toContain('[[');
    expect([...toolbar.dom.querySelectorAll<HTMLButtonElement>('button')]
      .some((button) => button.title === 'タスク')).toBe(false);
    expect([...toolbar.dom.querySelectorAll<HTMLButtonElement>('button')]
      .map((button) => button.title)).toEqual(expect.arrayContaining([
      'HTML画像を追加', 'リンク', '見出し', 'リスト', '太字', '表',
    ]));

    [...toolbar.dom.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.title === '太字')!.click();
    expect(editor.wrapSelection).toHaveBeenCalledWith('<strong>', '</strong>');
  });
});
