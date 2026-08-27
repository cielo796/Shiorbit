// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { close, openContextMenu } from '../src/ui/contextMenu';

afterEach(() => close());

function menu(): HTMLElement | null {
  return document.querySelector('.context-menu');
}

function items(): string[] {
  return [...(menu()?.querySelectorAll('.context-menu-item') ?? [])].map((n) => n.textContent ?? '');
}

/** 開いた直後は監視の登録を待つので、1順番だけ進める。 */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('右クリックメニュー', () => {
  it('項目を並べ、押すと閉じてから実行する', () => {
    const run = vi.fn(() => {
      // 実行時にはもう閉じている（続けて画面を触っても邪魔にならない）。
      expect(menu()).toBeNull();
    });
    openContextMenu(10, 10, [{ label: '閉じる', run }]);

    expect(items()).toEqual(['閉じる']);
    menu()!.querySelector<HTMLButtonElement>('.context-menu-item')!.click();
    expect(run).toHaveBeenCalledOnce();
  });

  it('enabled: false は消さずに押せなくする', () => {
    const run = vi.fn();
    openContextMenu(10, 10, [
      { label: '左側を閉じる（0）', enabled: false, run },
      { label: '右側を閉じる（2）', run },
    ]);

    const buttons = [...menu()!.querySelectorAll<HTMLButtonElement>('.context-menu-item')];
    expect(buttons[0]?.disabled).toBe(true);
    buttons[0]?.click();
    expect(run).not.toHaveBeenCalled();
  });

  it('項目が無ければ開かない', () => {
    openContextMenu(10, 10, []);
    expect(menu()).toBeNull();
  });

  it('二重に開かず、あとから開いたものだけが残る', async () => {
    openContextMenu(10, 10, [{ label: '一つ目', run: () => undefined }]);
    await settle();
    openContextMenu(20, 20, [{ label: '二つ目', run: () => undefined }]);

    expect(document.querySelectorAll('.context-menu')).toHaveLength(1);
    expect(items()).toEqual(['二つ目']);
  });

  it('外を押すと閉じる', async () => {
    openContextMenu(10, 10, [{ label: 'x', run: () => undefined }]);
    await settle();

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(menu()).toBeNull();
  });

  it('中を押しても閉じない（項目の実行が先）', async () => {
    openContextMenu(10, 10, [{ label: 'x', run: () => undefined }]);
    await settle();

    menu()!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(menu()).not.toBeNull();
  });

  it('Esc で閉じる', async () => {
    openContextMenu(10, 10, [{ label: 'x', run: () => undefined }]);
    await settle();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(menu()).toBeNull();
  });

  it('画面からはみ出さない位置に置く', () => {
    openContextMenu(99_999, 99_999, [{ label: 'x', run: () => undefined }]);

    // jsdom は寸法を 0 で返すので、少なくとも画面内に丸められることだけ見る。
    expect(Number.parseFloat(menu()!.style.left)).toBeLessThanOrEqual(window.innerWidth);
    expect(Number.parseFloat(menu()!.style.top)).toBeLessThanOrEqual(window.innerHeight);
  });
});
