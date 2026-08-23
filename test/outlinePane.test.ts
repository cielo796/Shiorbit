// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { OutlinePane } from '../src/ui/outlinePane';

describe('OutlinePane', () => {
  it('見出し階層を描画し、クリックしたオフセットを通知する', () => {
    const onReveal = vi.fn();
    const pane = new OutlinePane({ onReveal });
    pane.setHeadings([
      { level: 1, text: '概要', offset: 0 },
      { level: 2, text: '詳細', offset: 30 },
      { level: 3, text: '補足', offset: 80 },
    ]);

    const items = [...pane.dom.querySelectorAll<HTMLElement>('.outline-item')];
    expect(items.map((item) => item.textContent)).toEqual(['概要', '詳細', '補足']);
    expect(items[1]!.getAttribute('aria-level')).toBe('2');
    expect(items[1]!.style.getPropertyValue('--outline-level')).toBe('1');

    items[1]!.click();
    expect(onReveal).toHaveBeenCalledWith(30);
    expect(items[1]!.classList.contains('active')).toBe(true);
  });

  it('現在位置の直前にある見出しをハイライトする', () => {
    const pane = new OutlinePane({ onReveal: () => undefined });
    pane.setHeadings([
      { level: 1, text: 'A', offset: 10 },
      { level: 2, text: 'B', offset: 40 },
      { level: 2, text: 'C', offset: 90 },
    ]);

    pane.setCurrentOffset(65);
    expect(pane.dom.querySelector('.outline-item.active')?.textContent).toBe('B');
    pane.setCurrentOffset(100);
    expect(pane.dom.querySelector('.outline-item.active')?.textContent).toBe('C');
  });
});
