// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Explorer } from '../src/ui/explorer';
import { close } from '../src/ui/contextMenu';

afterEach(() => {
  close();
  document.body.replaceChildren();
});

function setup() {
  const opts = { onOpen: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(), onCreateIn: vi.fn() };
  const explorer = new Explorer(opts);
  document.body.append(explorer.dom);
  explorer.setEntries([
    { path: 'Projects', name: 'Projects', kind: 'dir' },
    { path: 'Projects/Notes', name: 'Notes', kind: 'dir' },
    { path: 'Projects/Notes/Existing.md', name: 'Existing.md', kind: 'file' },
    { path: 'Projects/Notes/Page.html', name: 'Page.html', kind: 'file' },
    { path: 'Empty', name: 'Empty', kind: 'dir' },
  ]);
  // 既存のメニュー操作テストは、保存済みの展開状態から始める。
  explorer.restoreExpandedFolders(['Projects', 'Projects/Notes', 'Empty']);
  const row = (path = 'Projects/Notes'): HTMLElement => {
    return [...explorer.dom.querySelectorAll<HTMLElement>('.row')]
      .find((element) => element.dataset['path'] === path)!;
  };
  const rightClick = (path?: string): MouseEvent => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 80 });
    row(path).querySelector('.label')!.dispatchEvent(event);
    return event;
  };
  return { explorer, opts, row, rightClick };
}

function choose(label: string): void {
  const button = [...document.querySelectorAll<HTMLButtonElement>('.context-menu-item')]
    .find((item) => item.textContent === label);
  expect(button).toBeDefined();
  button!.click();
}

describe('フォルダの右クリックメニュー', () => {
  it.each(['Projects/Notes/New.md', 'Projects/Notes/New.html', 'New.md'])('作成した %s を展開・強調し、編集フォーカスを保持する', (path) => {
    const { explorer, row, rightClick } = setup();
    rightClick();
    close();
    explorer.restoreExpandedFolders([]);
    explorer.setFilter(path.endsWith('.html') ? 'markdown' : 'html');
    explorer.setEntries([{ path, name: path.split('/').pop()!, kind: 'file' }]);
    const editor = document.createElement('textarea');
    document.body.append(editor);
    editor.focus();
    const scroll = vi.fn();
    const originalScroll = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scroll;
    explorer.revealCreated(path);
    expect(row(path).classList.contains('paste-target')).toBe(true);
    expect(row(path).classList.contains('active')).toBe(true);
    expect(explorer.dom.querySelectorAll('.paste-target')).toHaveLength(1);
    expect([...explorer.dom.querySelectorAll('.row[data-kind="dir"]')].every(r => r.getAttribute('aria-expanded') === 'true')).toBe(true);
    expect(explorer.pasteDestination()).toBe(path.includes('/') ? 'Projects/Notes' : '');
    expect(document.activeElement).toBe(editor);
    expect(scroll).toHaveBeenCalled();
    explorer.setFilter('markdown');
    explorer.setFilter('all');
    expect(row(path).classList.contains('paste-target')).toBe(true);
    HTMLElement.prototype.scrollIntoView = originalScroll;
  });
  it('既定は閉じる。保存したフォルダだけを展開し、追加フォルダは閉じる', () => {
    const explorer = new Explorer({ onOpen: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(), onCreateIn: vi.fn() });
    explorer.setEntries([{ path: 'A', name: 'A', kind: 'dir' }]);
    expect(explorer.dom.querySelector('.row')!.getAttribute('aria-expanded')).toBe('false');
    explorer.restoreExpandedFolders(['A']);
    const original = explorer.dom.querySelector('.row');
    expect(original!.getAttribute('aria-expanded')).toBe('true');
    explorer.restoreExpandedFolders([]);
    expect(explorer.dom.querySelector('.row')).toBe(original);
    explorer.setEntries([{ path: 'A', name: 'A', kind: 'dir' }, { path: 'New', name: 'New', kind: 'dir' }]);
    expect([...explorer.dom.querySelectorAll('.row')].every(row => row.getAttribute('aria-expanded') === 'false')).toBe(true);
  });
  it('ファイルの更新時刻だけが変わってもツリーDOMとフォーカスを維持する', () => {
    const { explorer, row } = setup();
    const original = row();
    original.focus();
    explorer.setEntries([
      { path: 'Projects', name: 'Projects', kind: 'dir' },
      { path: 'Projects/Notes', name: 'Notes', kind: 'dir' },
      { path: 'Projects/Notes/Existing.md', name: 'Existing.md', kind: 'file', mtime: 999 },
      { path: 'Projects/Notes/Page.html', name: 'Page.html', kind: 'file', mtime: 999 },
      { path: 'Empty', name: 'Empty', kind: 'dir' },
    ]);
    expect(row()).toBe(original);
    expect(document.activeElement).toBe(original);
  });
  it('三角は専用ボタンで、押した瞬間にDOMを作り直さず開閉する', () => {
    const { explorer, row } = setup();
    const originalRow = row();
    const caret = originalRow.querySelector<HTMLButtonElement>('button.caret')!;

    caret.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
    caret.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));

    expect(row()).toBe(originalRow);
    expect(originalRow.parentElement!.classList.contains('collapsed')).toBe(true);
    expect(originalRow.getAttribute('aria-expanded')).toBe('false');
    expect(caret.getAttribute('aria-expanded')).toBe('false');
    expect(caret.getAttribute('aria-label')).toBe('フォルダを展開');
    expect(document.activeElement).toBe(originalRow);

    // 選択状態が変わっても、同じ行DOMのままにする。
    explorer.setActive('Projects/Notes/Existing.md');
    expect(row()).toBe(originalRow);
    explorer.setActive('Projects/Notes/Existing.md');
    expect(row()).toBe(originalRow);
  });

  it('三角はキーボーからも開閉できる', () => {
    const { row } = setup();
    const caret = row().querySelector<HTMLButtonElement>('button.caret')!;
    caret.click();
    expect(row().parentElement!.classList.contains('collapsed')).toBe(true);
    caret.click();
    expect(row().parentElement!.classList.contains('collapsed')).toBe(false);
  });

  it('標準メニューを抑止し、フォルダを開閉せずに操作を表示する', () => {
    const { opts, row, rightClick } = setup();
    expect(rightClick().defaultPrevented).toBe(true);
    expect([...document.querySelectorAll('.context-menu-item')].map((item) => item.textContent)).toEqual([
      'Markdownを新規作成…', 'HTMLを新規作成…', 'サブフォルダを作成…', 'フォルダを折りたたむ', 'ごみ箱へ移す…',
    ]);
    expect(row().parentElement!.classList.contains('collapsed')).toBe(false);
    expect(opts.onOpen).not.toHaveBeenCalled();
    expect(opts.onDelete).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.querySelector('.context-menu-item'));
  });

  it.each([
    ['Markdownを新規作成…', 'markdown'],
    ['HTMLを新規作成…', 'html'],
    ['サブフォルダを作成…', 'folder'],
  ])('%s は右クリックしたフォルダと種別を渡す', (label, kind) => {
    const { opts, rightClick } = setup();
    rightClick();
    choose(label);
    expect(opts.onCreateIn).toHaveBeenCalledOnce();
    expect(opts.onCreateIn).toHaveBeenCalledWith('Projects/Notes', kind);
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('折りたたみ・展開の表示と操作が現在の状態に追従する', () => {
    const { row, rightClick } = setup();
    rightClick();
    choose('フォルダを折りたたむ');
    expect(row().parentElement!.classList.contains('collapsed')).toBe(true);
    expect(document.activeElement).toBe(row());
    rightClick();
    choose('フォルダを展開');
    expect(row().parentElement!.classList.contains('collapsed')).toBe(false);
  });

  it('ごみ箱への移動は既存の確認処理へ渡す', () => {
    const { opts, rightClick } = setup();
    rightClick();
    expect(document.querySelector('.context-menu-item.danger')?.textContent).toBe('ごみ箱へ移す…');
    choose('ごみ箱へ移す…');
    expect(opts.onDelete).toHaveBeenCalledOnce();
    expect(opts.onDelete).toHaveBeenCalledWith('Projects/Notes');
    expect(opts.onRename).not.toHaveBeenCalled();
  });

  it('空フォルダでも開けて、別のフォルダで開き直すと対象が切り替わる', () => {
    const { opts, rightClick } = setup();
    rightClick();
    rightClick('Empty');
    expect(document.querySelectorAll('.context-menu')).toHaveLength(1);
    choose('HTMLを新規作成…');
    expect(opts.onCreateIn).toHaveBeenCalledOnce();
    expect(opts.onCreateIn).toHaveBeenCalledWith('Empty', 'html');
  });

  it.each(['Projects/Notes/Existing.md', 'Projects/Notes/Page.html'])('%s の右クリックはファイル操作を表示し、勝手に開かない', (path) => {
    const { rightClick, opts, explorer, row } = setup();
    expect(rightClick(path).defaultPrevented).toBe(true);
    expect([...document.querySelectorAll('.context-menu-item')].map(item => item.textContent?.replace('›', '').trim())).toEqual([
      '開く', '名前を変更…', '同じフォルダに新規作成', 'ごみ箱へ移す…',
    ]);
    expect(opts.onOpen).not.toHaveBeenCalled();
    expect(explorer.pasteDestination()).toBe('Projects/Notes');
    expect(row(path).classList.contains('paste-target')).toBe(true);
    choose('名前を変更…');
    expect(opts.onRename).toHaveBeenCalledWith(path);
    rightClick(path);
    choose('開く');
    expect(opts.onOpen).toHaveBeenCalledWith(path);
    rightClick(path);
    choose('ごみ箱へ移す…');
    expect(opts.onDelete).toHaveBeenCalledWith(path);
  });

  it('HTMLファイルのメニューはフォーカスで同じフォルダの作成項目を開く', () => {
    const { rightClick, opts } = setup();
    rightClick('Projects/Notes/Page.html');
    const group = [...document.querySelectorAll<HTMLButtonElement>('.context-menu-item')]
      .find(item => item.textContent?.includes('同じフォルダに新規作成'))!;
    group.focus();
    choose('HTMLを新規作成…');
    expect(opts.onCreateIn).toHaveBeenCalledWith('Projects/Notes', 'html');
  });

  it('HTML行をキーボードで開く・メニューを出せる', () => {
    const { row, opts } = setup();
    const file = row('Projects/Notes/Page.html');
    file.focus();
    file.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(opts.onOpen).toHaveBeenCalledWith('Projects/Notes/Page.html');
    file.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
    choose('名前を変更…');
    expect(opts.onRename).toHaveBeenCalledWith('Projects/Notes/Page.html');
  });

  it.each([{ key: 'F10', shiftKey: true }, { key: 'ContextMenu' }])('$key からも開ける', (init) => {
    const { row } = setup();
    row().focus();
    row().dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }));
    expect(document.querySelector('.context-menu')).not.toBeNull();
  });

  it('行内の＋ボタンでは従来の新規作成を開き、フォルダを折りたたまない', () => {
    const { opts, row } = setup();
    row().querySelector<HTMLButtonElement>('.create')!.click();
    expect(opts.onCreateIn).toHaveBeenCalledOnce();
    expect(opts.onCreateIn).toHaveBeenCalledWith('Projects/Notes');
    expect(row().parentElement!.classList.contains('collapsed')).toBe(false);
    expect(document.querySelector('.context-menu')).toBeNull();
  });
});
