// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Explorer } from '../src/ui/explorer';
import { bindFileDrop } from '../src/ui/fileDrop';

function drag(target: Element, type: string, files = true, relatedTarget: EventTarget | null = null) {
  const transfer = { types: files ? ['Files'] : ['text/plain'], dropEffect: 'none' };
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, relatedTarget });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  target.dispatchEvent(event);
  return { event, transfer };
}
function setup() {
  const onDropFiles = vi.fn();
  const onMoveFile = vi.fn();
  const onOpen = vi.fn();
  const explorer = new Explorer({ onDropFiles, onMoveFile, onOpen, onRename: vi.fn(), onDelete: vi.fn(), onCreateIn: vi.fn() });
  explorer.setEntries([
    { path: 'Parent', name: 'Parent', kind: 'dir' },
    { path: 'Parent/Notes', name: 'Notes', kind: 'dir' },
    { path: 'Parent/Notes/a.md', name: 'a.md', kind: 'file' },
    { path: 'Root.md', name: 'Root.md', kind: 'file' },
  ]);
  document.body.append(explorer.dom);
  const row = (path: string): HTMLElement => [...explorer.dom.querySelectorAll<HTMLElement>('.row')].find((el) => el.dataset['path'] === path)!;
  return { explorer, onDropFiles, onMoveFile, onOpen, row };
}

function internalTransfer() {
  const data = new Map<string, string>();
  const transfer = {
    types: [] as string[],
    dropEffect: 'none',
    effectAllowed: 'none',
    setData(type: string, value: string) {
      data.set(type, value);
      transfer.types = [...data.keys()];
    },
    getData(type: string) {
      return data.get(type) ?? '';
    },
  };
  return transfer;
}

function internalDrag(target: Element, type: string, transfer: ReturnType<typeof internalTransfer>) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  target.dispatchEvent(event);
  return event;
}
afterEach(() => document.body.replaceChildren());

describe('フォルダへのファイルドロップ', () => {
  it('子フォルダのラベルを強調し、そのフォルダだけに一度渡す', () => {
    const { row, onDropFiles, onOpen } = setup();
    const label = row('Parent/Notes').querySelector('.label')!;
    const over = drag(label, 'dragover');
    expect(over.event.defaultPrevented).toBe(true);
    expect(over.transfer.dropEffect).toBe('copy');
    expect(row('Parent/Notes').classList.contains('file-drop-active')).toBe(true);
    expect(row('Parent').classList.contains('file-drop-active')).toBe(false);
    const drop = drag(label, 'drop');
    expect(drop.event.defaultPrevented).toBe(true);
    expect(onDropFiles.mock.calls).toEqual([['Parent/Notes', drop.transfer]]);
    expect(onOpen).not.toHaveBeenCalled();
    expect(document.querySelector('.file-drop-active')).toBeNull();
  });

  it('折りたたみ中のフォルダもドロップ先になる', () => {
    const { row, onDropFiles } = setup();
    // フォルダは初期状態で閉じている。
    expect(row('Parent/Notes').parentElement?.classList.contains('collapsed')).toBe(true);
    const drop = drag(row('Parent/Notes'), 'drop');
    expect(onDropFiles.mock.calls).toEqual([['Parent/Notes', drop.transfer]]);
  });

  it('一覧の余白・空の一覧・ルート見出しはルートに渡す', () => {
    const { explorer, onDropFiles } = setup();
    drag(explorer.dom.querySelector('.sidebar-body')!, 'drop');
    explorer.setEntries([]);
    drag(explorer.dom.querySelector('.tree-empty')!, 'drop');
    const heading = document.createElement('div');
    bindFileDrop(heading, onDropFiles);
    drag(heading, 'drop');
    expect(onDropFiles.mock.calls.map((call) => call[0])).toEqual(['', '', '']);
  });

  it('ノート上では親フォルダを強調し、同じフォルダへ取り込む', () => {
    const { row, onDropFiles } = setup();
    const target = row('Parent/Notes/a.md');
    expect(drag(target, 'dragover').transfer.dropEffect).toBe('copy');
    expect(row('Parent/Notes').classList.contains('file-drop-active')).toBe(true);
    expect(target.classList.contains('file-drop-active')).toBe(false);
    const dropped = drag(target, 'drop');
    expect(dropped.event.defaultPrevented).toBe(true);
    expect(onDropFiles.mock.calls).toEqual([['Parent/Notes', dropped.transfer]]);
  });

  it('ルート直下のノート上では一覧全体を強調し、ルートへ取り込む', () => {
    const { explorer, row, onDropFiles } = setup();
    const host = explorer.dom.querySelector<HTMLElement>('.sidebar-body')!;
    expect(drag(row('Root.md'), 'dragover').transfer.dropEffect).toBe('copy');
    expect(host.classList.contains('file-drop-active')).toBe(true);
    const dropped = drag(row('Root.md'), 'drop');
    expect(onDropFiles.mock.calls).toEqual([['', dropped.transfer]]);
  });

  it('文字列のドラッグは横取りせず、離れたときに強調を解除する', () => {
    const { row, onDropFiles } = setup();
    const target = row('Parent/Notes');
    expect(drag(target, 'dragover', false).event.defaultPrevented).toBe(false);
    expect(drag(target, 'drop', false).event.defaultPrevented).toBe(false);
    expect(onDropFiles).not.toHaveBeenCalled();
    drag(target, 'dragover');
    drag(target, 'dragleave', true, target.querySelector('.label'));
    expect(target.classList.contains('file-drop-active')).toBe(true);
    drag(target, 'dragleave');
    expect(target.classList.contains('file-drop-active')).toBe(false);
  });

  it('取り込み後は祖先を展開して表示フィルタを調整する', () => {
    const { explorer, row } = setup();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    row('Parent').click();
    explorer.setFilter('html');
    explorer.revealImported('Parent/Notes/a.md');
    expect(row('Parent').parentElement?.classList.contains('collapsed')).toBe(false);
    expect(row('Parent/Notes/a.md')).toBeDefined();
    expect(scroll).toHaveBeenCalledOnce();
  });
});

describe('ツリー内の既存ファイル移動', () => {
  it('フォルダ行・ファイル行・余白をそれぞれ正しい移動先として扱う', () => {
    const { explorer, row, onMoveFile, onDropFiles, onOpen } = setup();
    const source = row('Parent/Notes/a.md');
    expect(source.draggable).toBe(true);

    const toParent = internalTransfer();
    internalDrag(source, 'dragstart', toParent);
    const parentLabel = row('Parent').querySelector('.label')!;
    const over = internalDrag(parentLabel, 'dragover', toParent);
    expect(over.defaultPrevented).toBe(true);
    expect(toParent.dropEffect).toBe('move');
    expect(row('Parent').classList.contains('file-move-active')).toBe(true);
    internalDrag(parentLabel, 'drop', toParent);

    const toNotes = internalTransfer();
    internalDrag(row('Root.md'), 'dragstart', toNotes);
    internalDrag(row('Parent/Notes/a.md'), 'drop', toNotes);

    const toRoot = internalTransfer();
    internalDrag(source, 'dragstart', toRoot);
    internalDrag(explorer.dom.querySelector('.sidebar-body')!, 'drop', toRoot);

    expect(onMoveFile.mock.calls).toEqual([
      ['Parent/Notes/a.md', 'Parent'],
      ['Root.md', 'Parent/Notes'],
      ['Parent/Notes/a.md', ''],
    ]);
    expect(onDropFiles).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    expect(document.querySelector('.file-move-active')).toBeNull();

    internalDrag(source, 'dragend', toRoot);
    expect(source.classList.contains('file-move-source')).toBe(false);
  });

  it('同じフォルダへのドロップは移動を発火しない', () => {
    const { row, onMoveFile } = setup();
    const transfer = internalTransfer();
    internalDrag(row('Parent/Notes/a.md'), 'dragstart', transfer);
    internalDrag(row('Parent/Notes'), 'drop', transfer);
    expect(onMoveFile).not.toHaveBeenCalled();
  });
});
