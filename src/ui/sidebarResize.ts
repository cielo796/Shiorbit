import { normalizeSidebarWidth } from '../core/settings/workspaceLayout';

/** ドラッグは専用ハンドルが捕捉し、描画は一フレームに一度だけ行う。 */
export function bindSidebarResize(workspace: HTMLElement, sidebar: HTMLElement, onCommit: () => void) {
  const handle = document.createElement('div');
  handle.className = 'sidebar-resize-handle';
  handle.tabIndex = 0;
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-label', 'サイドバーの幅');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.title = 'ドラッグで幅を変更・ダブルクリックで元の幅に戻す';
  const guide = document.createElement('div');
  guide.className = 'sidebar-resize-guide';
  guide.hidden = true;
  sidebar.append(handle, guide);
  let width = 260;
  let frame: number | null = null;
  let drag: { id: number; startX: number; startWidth: number; nextWidth: number; max: number } | null = null;
  const setWidth = (value: number) => {
    width = normalizeSidebarWidth(value);
    workspace.style.setProperty('--sidebar-preferred-w', `${width}px`);
    handle.setAttribute('aria-valuenow', String(width));
  };
  handle.setAttribute('aria-valuemin', '200');
  handle.setAttribute('aria-valuemax', '600');
  setWidth(width);
  const finish = (cancel: boolean) => {
    if (!drag) return;
    const previous = drag;
    drag = null;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    guide.hidden = true;
    workspace.classList.remove('resizing-sidebar');
    window.removeEventListener('blur', cancelDrag);
    window.removeEventListener('resize', cancelDrag);
    document.removeEventListener('visibilitychange', visibilityChanged);
    window.removeEventListener('pointerup', pointerUp, true);
    window.removeEventListener('keydown', escapeDrag, true);
    try {
      if (handle.hasPointerCapture(previous.id)) handle.releasePointerCapture(previous.id);
    } catch { /* ウィンドウや要素が破棄された場合も覆いの解除を優先する。 */ }
    if (!cancel && width !== previous.nextWidth) {
      setWidth(previous.nextWidth);
      onCommit();
    }
  };
  const cancelDrag = () => finish(true);
  const visibilityChanged = () => { if (document.hidden) finish(true); };
  const escapeDrag = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    finish(true);
  };
  const updateGuide = (x: number) => {
    if (!drag) return;
    // 幅の読み取りは開始時の一度だけ。本文の折り返し・再描画は確定時だけ行う。
    drag.nextWidth = normalizeSidebarWidth(Math.min(drag.max, drag.startWidth + x - drag.startX));
    if (frame === null) frame = requestAnimationFrame(() => {
      frame = null;
      if (drag) guide.style.transform = `translate3d(${drag.nextWidth - drag.startWidth}px, 0, 0)`;
    });
  };
  const pointerUp = (event: PointerEvent) => {
    if (drag?.id !== event.pointerId) return;
    updateGuide(event.clientX);
    finish(false);
  };
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    handle.focus();
    try { handle.setPointerCapture(event.pointerId); } catch { return; }
    const startWidth = sidebar.getBoundingClientRect().width;
    drag = { id: event.pointerId, startX: event.clientX, startWidth, nextWidth: width,
      max: Math.min(600, workspace.getBoundingClientRect().width / 2) };
    guide.style.transform = 'translateX(0)';
    guide.hidden = false;
    workspace.classList.add('resizing-sidebar');
    window.addEventListener('blur', cancelDrag);
    window.addEventListener('resize', cancelDrag);
    document.addEventListener('visibilitychange', visibilityChanged);
    window.addEventListener('pointerup', pointerUp, true);
    window.addEventListener('keydown', escapeDrag, true);
  });
  handle.addEventListener('pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    // ウィンドウ外で離した等で pointerup が届かなかった場合も操作を終了する。
    if (event.buttons === 0) { finish(false); return; }
    updateGuide(event.clientX);
  });
  handle.addEventListener('pointerup', pointerUp);
  handle.addEventListener('pointercancel', (event) => { if (drag?.id === event.pointerId) finish(true); });
  handle.addEventListener('lostpointercapture', (event) => { if (drag?.id === event.pointerId) finish(true); });
  handle.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drag) { event.preventDefault(); finish(true); return; }
    if (drag || !['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
    event.preventDefault();
    setWidth(event.key === 'Home' ? 260 : width + (event.key === 'ArrowLeft' ? -10 : 10));
    onCommit();
  });
  handle.addEventListener('dblclick', () => { setWidth(260); onCommit(); });
  return { setWidth, getWidth: () => width, destroy: cancelDrag };
}
