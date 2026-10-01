// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MarkdownEditor } from '../src/ui/editor';
import { close } from '../src/ui/contextMenu';

const editors: MarkdownEditor[] = [];

beforeAll(() => {
  const proto = Range.prototype as unknown as Record<string, unknown>;
  proto['getBoundingClientRect'] = () => ({
    x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
    toJSON: () => ({}),
  });
  proto['getClientRects'] = () => Object.assign([], { item: () => null });
});

function setup(text = '本文', options: { onPickImage?: () => Promise<string | null> } = {}) {
  const onChange = vi.fn();
  const editor = new MarkdownEditor({
    onChange,
    onSave: vi.fn(),
    floatingSearch: false,
    ...options,
  });
  editors.push(editor);
  document.body.append(editor.dom);
  editor.setDoc(text);
  const content = editor.dom.querySelector<HTMLElement>('.cm-content')!;
  return { editor, content, onChange };
}

function open(content: HTMLElement): MouseEvent {
  const event = new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: 12, clientY: 12,
  });
  content.dispatchEvent(event);
  return event;
}

function choose(label: string): void {
  const item = [...document.querySelectorAll<HTMLButtonElement>('.context-menu-item')]
    .find((button) => button.textContent === label);
  expect(item).toBeDefined();
  item!.click();
}

afterEach(() => {
  close();
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

describe('Markdown右クリック編集メニュー', () => {
  it('基本操作を直下に置き、画像・書式・ブロック操作をサブメニューへまとめる', () => {
    const { content } = setup();
    expect(open(content).defaultPrevented).toBe(true);
    expect([...document.querySelectorAll('.context-menu-section')].map((node) => node.textContent)).toEqual([
      '編集',
    ]);
    const rootMenu = document.querySelector('.context-menu[data-depth="0"]')!;
    expect([...rootMenu.querySelectorAll(':scope > .context-menu-item')].map((node) => node.textContent)).toEqual([
      '元に戻す', 'やり直す', '切り取り', 'コピー', '貼り付け', '選択範囲を削除',
      'すべて選択', '検索…', 'リンク・画像', '文字装飾', '段落・ブロック',
    ]);
    expect(document.querySelectorAll('.has-submenu')).toHaveLength(3);

    choose('リンク・画像');
    expect([...rootMenu.querySelectorAll(':scope > .context-menu-item')].map((node) => node.textContent)).toContain('リンク・画像');
    expect([...document.querySelectorAll('.context-submenu .context-menu-item')].map((node) => node.textContent)).toEqual([
      'PCから画像を追加…', '画像パス・URLを挿入…', 'Webリンクを挿入…',
      'Wikiリンクを挿入', 'ノートを埋め込み',
    ]);
  });

  it('選択範囲へ文字装飾を適用する', () => {
    const { editor, content } = setup('選択する');
    editor.setViewState({ anchor: 0, head: 4, scrollTop: 0 });
    open(content);
    choose('文字装飾');
    choose('太字');
    expect(editor.getDoc()).toBe('**選択する**');
  });

  it('見出しレベルを重ねずに置き換え、表も挿入できる', () => {
    const { editor, content } = setup('# 見出し');
    editor.setViewState({ anchor: 3, head: 3, scrollTop: 0 });
    open(content);
    choose('段落・ブロック');
    choose('見出し3');
    expect(editor.getDoc()).toBe('### 見出し');

    editor.setViewState({ anchor: editor.getDoc().length, head: editor.getDoc().length, scrollTop: 0 });
    open(content);
    choose('段落・ブロック');
    choose('表（3列）');
    expect(editor.getDoc()).toContain('| 列1 | 列2 | 列3 |');
  });

  it('PCから保存した画像の参照を選択文字列つきで挿入する', async () => {
    const onPickImage = vi.fn(async () => 'attachments/photo.png');
    const { editor, content } = setup('説明', { onPickImage });
    editor.setViewState({ anchor: 0, head: 2, scrollTop: 0 });
    open(content);
    choose('リンク・画像');
    choose('PCから画像を追加…');
    await Promise.resolve();
    await Promise.resolve();
    expect(onPickImage).toHaveBeenCalledOnce();
    expect(editor.getDoc()).toBe('![[attachments/photo.png|説明]]');
  });

  it('WebリンクはURL入力後に選択文字列へ適用する', async () => {
    const { editor, content } = setup('公式サイト');
    editor.setViewState({ anchor: 0, head: 5, scrollTop: 0 });
    open(content);
    choose('リンク・画像');
    choose('Webリンクを挿入…');

    const dialog = document.querySelector('.prompt-dialog')!;
    const input = dialog.querySelector<HTMLInputElement>('.dialog-input')!;
    input.value = 'https://example.com/page';
    input.dispatchEvent(new Event('input'));
    [...dialog.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '挿入')!.click();
    await Promise.resolve();
    expect(editor.getDoc()).toBe('[公式サイト](https://example.com/page)');
  });

  it('HTML編集時はHTML専用メニューへ切り替え、選択範囲へ要素を挿入する', () => {
    const { editor, content } = setup('選択する');
    editor.setLanguage('html');
    editor.setViewState({ anchor: 0, head: 4, scrollTop: 0 });
    expect(open(content).defaultPrevented).toBe(true);

    const rootLabels = [...document.querySelectorAll('.context-menu[data-depth="0"] > .context-menu-item')]
      .map((node) => node.textContent);
    expect(rootLabels).toContain('HTML挿入');
    expect(rootLabels).not.toContain('リンク・画像');

    choose('HTML挿入');
    expect([...document.querySelectorAll('.context-menu[data-depth="1"] > .context-menu-item')]
      .map((node) => node.textContent)).toEqual([
      'リンク…', '画像…', '見出し', 'リスト', '表', '選択範囲をタグで囲む…',
    ]);
    choose('見出し');
    choose('見出し2');
    expect(editor.getDoc()).toBe('<h2>選択する</h2>');
  });
});
