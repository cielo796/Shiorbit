// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { close, openContextMenu } from '../src/ui/contextMenu';

afterEach(() => close());

function menu(): HTMLElement | null {
  return document.querySelector('.context-menu');
}

function items(): string[] {
  return [...(menu()?.querySelectorAll(':scope > .context-menu-item') ?? [])].map((n) => n.textContent ?? '');
}

function submenuItems(): string[] {
  const submenu = document.querySelector('.context-submenu');
  return [...(submenu?.querySelectorAll(':scope > .context-menu-item') ?? [])].map((n) => n.textContent ?? '');
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

  it('ポインターを押した時点で実行し、続く click では二重実行しない', () => {
    const run = vi.fn();
    openContextMenu(10, 10, [{ label: '作成', run }]);
    const button = menu()!.querySelector<HTMLButtonElement>('.context-menu-item')!;

    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(menu()).toBeNull();
    expect(run).toHaveBeenCalledOnce();

    // ブラウザによっては取り外された要素にも click が続くため、明示的に再現する。
    button.click();
    expect(run).toHaveBeenCalledOnce();
  });

  it('区分見出しはボタンにせず、キーボード移動の対象外にする', () => {
    openContextMenu(10, 10, [
      { label: '編集', section: true },
      { label: 'コピー', run: () => undefined },
    ]);
    expect(menu()?.querySelector('.context-menu-section')?.textContent).toBe('編集');
    expect(items()).toEqual(['コピー']);
  });

  it('親メニューを残したまま右側へ詳細を表示して実行できる', async () => {
    const run = vi.fn();
    openContextMenu(10, 10, [
      { label: 'コピー', run: () => undefined },
      {
        label: '文字装飾',
        children: [
          { label: '太字', run },
          { label: '斜体', run: () => undefined },
        ],
      },
    ]);

    expect(items()).toEqual(['コピー', '文字装飾']);
    menu()!.querySelector<HTMLButtonElement>('.has-submenu')!.click();
    expect(items()).toEqual(['コピー', '文字装飾']);
    expect(submenuItems()).toEqual(['太字', '斜体']);
    expect(document.querySelectorAll('.context-menu')).toHaveLength(2);
    expect(document.activeElement?.textContent).toBe('太字');

    await settle();
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(document.activeElement?.textContent).toBe('文字装飾');
    expect(submenuItems()).toEqual(['太字', '斜体']);

    menu()!.querySelector<HTMLButtonElement>('.has-submenu')!.click();
    [...document.querySelectorAll<HTMLButtonElement>('.context-submenu .context-menu-item')]
      .find((button) => button.textContent === '太字')!.click();
    expect(menu()).toBeNull();
    expect(run).toHaveBeenCalledOnce();
  });

  it('右矢印でサブメニューを開き、左矢印で親へ戻る', async () => {
    openContextMenu(10, 10, [{
      label: 'リンク・画像',
      children: [{ label: '画像を追加', run: () => undefined }],
    }]);
    await settle();

    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(items()).toEqual(['リンク・画像']);
    expect(submenuItems()).toEqual(['画像を追加']);
    expect(document.activeElement?.textContent).toBe('画像を追加');

    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(items()).toEqual(['リンク・画像']);
    expect(submenuItems()).toEqual(['画像を追加']);
    expect(document.activeElement?.textContent).toBe('リンク・画像');
  });

  it('サブメニュー項目へフォーカスした時点で内容を表示する', async () => {
    openContextMenu(10, 10, [
      { label: '検索', run: () => undefined },
      { label: '文字装飾', children: [{ label: '太字', run: () => undefined }] },
    ]);
    await settle();
    expect(document.activeElement?.textContent).toBe('検索');

    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(items()).toEqual(['検索', '文字装飾']);
    expect(submenuItems()).toEqual(['太字']);
    expect(document.activeElement?.textContent).toBe('文字装飾');

    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement?.textContent).toBe('太字');
  });

  it('サブメニュー項目へポインターを乗せた時点で内容を表示する', () => {
    openContextMenu(10, 10, [
      { label: '検索', run: () => undefined },
      { label: 'リンク・画像', children: [{ label: '画像を追加', run: () => undefined }] },
    ]);
    menu()!.querySelector<HTMLButtonElement>('.has-submenu')!
      .dispatchEvent(new PointerEvent('pointerenter'));
    expect(items()).toEqual(['検索', 'リンク・画像']);
    expect(submenuItems()).toEqual(['画像を追加']);
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

  it('矢印・Home・End で無効な項目を飛ばして移動し、Esc で元の場所に戻る', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    openContextMenu(10, 10, [
      { label: '無効', enabled: false, run: () => undefined },
      { label: '先頭', run: () => undefined },
      { label: '末尾', run: () => undefined },
    ]);
    await settle();
    expect(document.activeElement?.textContent).toBe('先頭');
    const key = (value: string): void => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }));
    };
    key('ArrowUp');
    expect(document.activeElement?.textContent).toBe('末尾');
    key('ArrowDown');
    expect(document.activeElement?.textContent).toBe('先頭');
    key('End');
    expect(document.activeElement?.textContent).toBe('末尾');
    key('Home');
    expect(document.activeElement?.textContent).toBe('先頭');
    key('Escape');
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('開いた直後に閉じても遅延したイベント監視が残らない', async () => {
    const add = vi.spyOn(document, 'addEventListener');
    openContextMenu(10, 10, [{ label: 'x', run: () => undefined }]);
    close();
    await settle();
    expect(add.mock.calls.some(([type]) => type === 'pointerdown' || type === 'keydown')).toBe(false);
    add.mockRestore();
  });
});
