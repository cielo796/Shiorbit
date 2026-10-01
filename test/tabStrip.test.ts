// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TabStrip, type TabState } from '../src/ui/tabStrip';

const tabs: TabState[] = [
  { path: 'a.md', dirty: false },
  { path: 'b.html', dirty: false },
];

afterEach(() => document.body.replaceChildren());

function setup() {
  const opts = { onSelect: vi.fn(), onClose: vi.fn(), onMenu: vi.fn() };
  const strip = new TabStrip(opts);
  strip.setTabs(tabs, 'a.md');
  document.body.append(strip.dom);
  return { strip, ...opts };
}

function mouse(target: Element, type: string, button = 0): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button });
  target.dispatchEvent(event);
  return event;
}

describe('タブの閉じる操作', () => {
  it.each([0, 1])('タブ %i の×を押して離すまで選択せず、クリック時に一度だけ閉じる', async (index) => {
    const { strip, onSelect, onClose } = setup();
    const close = strip.dom.querySelectorAll<HTMLButtonElement>('.tab-close')[index]!;
    mouse(close, 'pointerdown');
    mouse(close, 'mousedown');
    close.focus();
    await Promise.resolve();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(close.isConnected).toBe(true);
    mouse(close, 'mouseup');
    mouse(close, 'click');
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose.mock.calls).toEqual([[tabs[index]!.path]]);
  });

  it('分割ペインのcapture/focusin更新や保存状態の更新でも押している×を保持する', () => {
    const { strip, onSelect, onClose } = setup();
    const pane = document.createElement('div');
    document.body.append(pane);
    pane.append(strip.dom);
    const refresh = (): void => strip.setTabs(tabs, 'a.md');
    pane.addEventListener('pointerdown', refresh, true);
    pane.addEventListener('focusin', refresh);
    const close = strip.dom.querySelector<HTMLButtonElement>('.tab-close')!;
    mouse(close, 'pointerdown');
    expect(strip.dom.querySelector('.tab-close')).toBe(close);
    mouse(close, 'mousedown');
    close.focus();
    strip.setTabs([{ path: 'a.md', dirty: true }, tabs[1]!], 'a.md');
    expect(strip.dom.querySelector('.tab-close')).toBe(close);
    expect(document.activeElement).toBe(close);
    expect(close.parentElement?.classList.contains('dirty')).toBe(true);
    mouse(close, 'mouseup');
    mouse(close, 'click');
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose.mock.calls).toEqual([['a.md']]);
  });

  it('ラベルは左クリックで選択し、×もラベルも中クリックで一度だけ閉じる', () => {
    const { strip, onSelect, onClose } = setup();
    const label = strip.dom.querySelector('.tab-label')!;
    const close = strip.dom.querySelector('.tab-close')!;
    mouse(label, 'mousedown');
    expect(onSelect.mock.calls).toEqual([['a.md']]);
    onSelect.mockClear();
    for (const target of [label, close]) {
      onClose.mockClear();
      expect(mouse(target, 'mousedown', 1).defaultPrevented).toBe(true);
      mouse(target, 'mouseup', 1);
      mouse(target, 'auxclick', 1);
      expect(onClose.mock.calls).toEqual([['a.md']]);
      expect(onSelect).not.toHaveBeenCalled();
    }
  });

  it('ボタンのキーボード由来のclickは閉じるだけを実行できる', () => {
    const { strip, onSelect, onClose } = setup();
    const close = strip.dom.querySelector<HTMLButtonElement>('.tab-close')!;
    expect(close.type).toBe('button');
    expect(close.getAttribute('aria-label')).toBe('a.md を閉じる');
    close.focus();
    close.click();
    expect(onClose.mock.calls).toEqual([['a.md']]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('右クリックでは選択・閉じるを実行せずメニューを開く', () => {
    const { strip, onSelect, onClose, onMenu } = setup();
    const close = strip.dom.querySelector('.tab-close')!;
    mouse(close, 'mousedown', 2);
    expect(mouse(close, 'contextmenu', 2).defaultPrevented).toBe(true);
    expect(onMenu.mock.calls).toEqual([['a.md', 0, 0]]);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('順序・選択・削除を反映し、残るタブとイベントの対応を保持する', () => {
    const { strip, onClose } = setup();
    const original = [...strip.dom.children];
    strip.setTabs([tabs[1]!, tabs[0]!], 'b.html');
    expect([...strip.dom.children]).toEqual([original[1], original[0]]);
    expect(original[1]!.getAttribute('aria-selected')).toBe('true');
    expect(original[0]!.getAttribute('aria-selected')).toBe('false');
    strip.setTabs([tabs[1]!], 'b.html');
    expect(original[0]!.isConnected).toBe(false);
    expect(strip.dom.style.display).toBe('none');
    strip.setTabs(tabs, 'a.md');
    expect(strip.dom.children[0]).not.toBe(original[0]);
    expect(strip.dom.children[1]).toBe(original[1]);
    expect(strip.dom.style.display).toBe('');
    strip.dom.querySelectorAll<HTMLButtonElement>('.tab-close')[1]!.click();
    expect(onClose.mock.calls).toEqual([['b.html']]);
    strip.setTabs([], null);
    expect(strip.dom.children).toHaveLength(0);
  });
});
