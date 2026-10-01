// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindSidebarResize } from '../src/ui/sidebarResize';
import { EMPTY_LAYOUT, isEmptyLayout, parseLayout, serializeLayout } from '../src/core/settings/workspaceLayout';
let paint: FrameRequestCallback | undefined;
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => { paint = cb; return 1; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const workspace = document.createElement('div');
  const sidebar = document.createElement('aside');
  workspace.append(sidebar);
  workspace.getBoundingClientRect = () => ({ width: 1000 }) as DOMRect;
  sidebar.getBoundingClientRect = () => ({ width: 260 }) as DOMRect;
  const commit = vi.fn();
  const resize = bindSidebarResize(workspace, sidebar, commit);
  const handle = sidebar.querySelector<HTMLElement>('[role="separator"]')!;
  handle.setPointerCapture = vi.fn();
  handle.hasPointerCapture = () => true;
  handle.releasePointerCapture = vi.fn();
  const pointer = (type: string, x: number, buttons = 1) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { button: 0, buttons, pointerId: 1, clientX: x });
    handle.dispatchEvent(event);
  };
  return { workspace, sidebar, handle, commit, resize, pointer };
}

describe('サイドバーの幅変更', () => {
  it('境界のドラッグで幅を変更し、終了時だけ保存する', () => {
    const { sidebar, resize, commit, pointer } = setup();
    pointer('pointerdown', 260);
    pointer('pointermove', 400);
    expect(resize.getWidth()).toBe(260);
    paint!(0);
    expect(sidebar.querySelector<HTMLElement>('.sidebar-resize-guide')!.style.transform).toBe('translate3d(140px, 0, 0)');
    expect(sidebar.querySelector('.sidebar-resize-shield')).toBeNull();
    expect(commit).not.toHaveBeenCalled();
    pointer('pointermove', 900);
    expect(resize.getWidth()).toBe(260);
    pointer('pointerup', 900);
    expect(resize.getWidth()).toBe(500);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(sidebar.querySelector<HTMLElement>('.sidebar-resize-guide')!.hidden).toBe(true);
  });

  it('中断は開始前の幅へ戻し、ダブルクリックは標準幅へ戻す', () => {
    const { resize, commit, pointer, handle, workspace } = setup();
    resize.setWidth(350);
    pointer('pointerdown', 350);
    pointer('pointermove', 100);
    expect(resize.getWidth()).toBe(350);
    pointer('pointercancel', 100);
    expect(resize.getWidth()).toBe(350);
    expect(workspace.classList.contains('resizing-sidebar')).toBe(false);
    expect(commit).not.toHaveBeenCalled();
    handle.dispatchEvent(new MouseEvent('dblclick'));
    expect(resize.getWidth()).toBe(260);
  });

  it('タブがなくても幅を復元し、異常な幅を制限する', () => {
    const restored = parseLayout(serializeLayout({ ...EMPTY_LAYOUT, sidebarWidth: 420 }));
    expect(restored.sidebarWidth).toBe(420);
    expect(isEmptyLayout(restored)).toBe(false);
    expect(parseLayout(serializeLayout({ ...EMPTY_LAYOUT, sidebarWidth: 9999 })).sidebarWidth).toBe(600);
    expect(parseLayout(serializeLayout({ ...EMPTY_LAYOUT, sidebarWidth: -20 })).sidebarWidth).toBe(200);
  });

  it.each(['blur', 'pointercancel', 'lostpointercapture', 'Escape', 'destroy'])('%s で覆いと操作状態を解除する', (reason) => {
    const { resize, pointer, sidebar, workspace, commit } = setup();
    pointer('pointerdown', 260);
    pointer('pointermove', 400);
    if (reason === 'blur') window.dispatchEvent(new Event('blur'));
    else if (reason === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    else if (reason === 'destroy') resize.destroy();
    else pointer(reason, 400);
    expect(sidebar.querySelector<HTMLElement>('.sidebar-resize-guide')!.hidden).toBe(true);
    expect(workspace.classList.contains('resizing-sidebar')).toBe(false);
    expect(resize.getWidth()).toBe(260);
    expect(commit).not.toHaveBeenCalled();
  });

  it('多数のマウス移動でもレイアウトを読み直さず、本文の幅を書き換えない', () => {
    const { pointer, workspace, sidebar, resize } = setup();
    const read = vi.spyOn(workspace, 'getBoundingClientRect');
    const write = vi.spyOn(workspace.style, 'setProperty');
    pointer('pointerdown', 260);
    for (let x = 261; x <= 460; x++) pointer('pointermove', x);
    expect(read).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    pointer('pointermove', 460, 0);
    expect(resize.getWidth()).toBe(460);
    expect(write).toHaveBeenCalledTimes(1);
    expect(sidebar.querySelector<HTMLElement>('.sidebar-resize-guide')!.hidden).toBe(true);
  });
});
