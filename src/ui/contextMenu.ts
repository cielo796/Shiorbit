import { el } from './dom';

export interface MenuItem {
  label: string;
  /** 操作ではなく、長いメニューを分ける見出し。 */
  section?: boolean;
  /** false なら灰色にして押せなくする（項目自体は消さない） */
  enabled?: boolean;
  /** 削除など、確認が必要な操作を区別する。 */
  danger?: boolean;
  /** 親メニューを残したまま右側へ表示する子項目。 */
  children?: readonly MenuItem[];
  run?: () => void;
}

/**
 * 右クリックで出す小さなメニュー。
 *
 * モーダルではないので、外側を押す・Esc・スクロールのどれでも閉じる。
 * 子項目は親メニューの右側へ展開し、画面からはみ出す場合だけ左へ回す。
 */
export function openContextMenu(x: number, y: number, items: readonly MenuItem[]): void {
  if (items.length === 0) return;
  close();

  const layer = el('div', 'context-menu-layer');
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const panels: HTMLElement[] = [];
  const triggers: HTMLButtonElement[] = [];

  const bind = (button: HTMLButtonElement, action: () => void): void => {
    let handledPointer = false;
    // マウスやタッチでは、指を離した後の click を待たずに実行する。
    // 再描画やフォーカス移動で click が失われる環境でも確実に反応させる。
    button.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      handledPointer = true;
      action();
    });
    button.addEventListener('click', () => {
      // キーボード操作と HTMLElement.click() は pointerdown を伴わない。
      if (handledPointer) {
        handledPointer = false;
        return;
      }
      action();
    });
  };

  /** depth のパネルは残し、それより深い詳細だけ閉じる。 */
  const closeAfter = (depth: number): void => {
    while (panels.length > depth + 1) panels.pop()?.remove();
    while (triggers.length > depth) triggers.pop()?.setAttribute('aria-expanded', 'false');
  };

  const placeSubmenu = (panel: HTMLElement, trigger: HTMLButtonElement): void => {
    const triggerRect = trigger.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const right = triggerRect.right + 4;
    const left = right + panelRect.width <= window.innerWidth - 4
      ? right
      : Math.max(4, triggerRect.left - panelRect.width - 4);
    const top = Math.max(4, Math.min(triggerRect.top, window.innerHeight - panelRect.height - 4));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  };

  const openChildren = (
    button: HTMLButtonElement,
    item: MenuItem,
    depth: number,
    focusFirst: boolean,
  ): void => {
    const existing = panels[depth + 1];
    if (existing && triggers[depth] === button) {
      if (focusFirst) existing.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
      return;
    }
    closeAfter(depth);
    const child = buildPanel(item.children ?? [], depth + 1);
    child.classList.add('context-submenu');
    layer.append(child);
    panels.push(child);
    triggers.push(button);
    button.setAttribute('aria-expanded', 'true');
    placeSubmenu(child, button);
    if (focusFirst) child.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  };

  const buildPanel = (panelItems: readonly MenuItem[], depth: number): HTMLElement => {
    const panel = el('div', 'context-menu');
    panel.setAttribute('role', 'menu');
    panel.dataset.depth = String(depth);

    for (const item of panelItems) {
      if (item.section) {
        const section = el('div', 'context-menu-section', item.label);
        section.setAttribute('role', 'separator');
        panel.append(section);
        continue;
      }

      const button = el('button', 'context-menu-item', item.label);
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      if (item.danger) button.classList.add('danger');
      if (item.children?.length) {
        button.classList.add('has-submenu');
        button.setAttribute('aria-haspopup', 'menu');
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-label', `${item.label} サブメニュー`);
      }

      if (item.enabled === false) {
        button.disabled = true;
      } else if (item.children?.length) {
        bind(button, () => openChildren(button, item, depth, true));
        // マウスを乗せるかキーボードフォーカスが移った時点で、親を残して詳細を表示する。
        button.addEventListener('pointerenter', () => openChildren(button, item, depth, false));
        button.addEventListener('focus', () => openChildren(button, item, depth, false));
      } else {
        bind(button, () => {
          close();
          item.run?.();
        });
        // 親側の別項目へ移ったときは、開いていた兄弟の詳細を閉じる。
        button.addEventListener('pointerenter', () => closeAfter(depth));
        button.addEventListener('focus', () => closeAfter(depth));
      }
      panel.append(button);
    }
    return panel;
  };

  const root = buildPanel(items, 0);
  layer.append(root);
  document.body.append(layer);
  current = layer;
  panels.push(root);

  // 大きさは置いてみないと分からないので、付けてから位置を決める。
  const rect = root.getBoundingClientRect();
  const left = Math.max(4, Math.min(x, window.innerWidth - rect.width - 4));
  const top = Math.max(4, Math.min(y, window.innerHeight - rect.height - 4));
  root.style.left = `${left}px`;
  root.style.top = `${top}px`;

  root.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  // 開いたクリックそのもので閉じないよう、次の順番から見張る。
  listenTimer = setTimeout(() => {
    listenTimer = null;
    if (current !== layer) return;
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close);
    window.addEventListener('wheel', close, { passive: true });
  }, 0);
}

let current: HTMLElement | null = null;
let returnFocus: HTMLElement | null = null;
let listenTimer: ReturnType<typeof setTimeout> | null = null;

function onOutside(event: PointerEvent): void {
  if (current && event.target instanceof Node && current.contains(event.target)) return;
  close();
}

function onKey(event: KeyboardEvent): void {
  if (!current) return;
  if (event.key === 'Tab') {
    close();
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    close();
    return;
  }

  const active = document.activeElement;
  if (!(active instanceof HTMLButtonElement)) return;
  const panel = active.closest<HTMLElement>('.context-menu');
  if (!panel) return;

  if (event.key === 'ArrowRight') {
    if (!active.classList.contains('has-submenu')) return;
    event.preventDefault();
    event.stopPropagation();
    const depth = Number(panel.dataset.depth ?? '0');
    const child = current.querySelector<HTMLElement>(`.context-menu[data-depth="${depth + 1}"]`);
    child?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return;
  }
  if (event.key === 'ArrowLeft') {
    const depth = Number(panel.dataset.depth ?? '0');
    if (depth === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const trigger = current.querySelector<HTMLButtonElement>(
      `.context-menu[data-depth="${depth - 1}"] .context-menu-item[aria-expanded="true"]`,
    );
    trigger?.focus();
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  const buttons = [...panel.querySelectorAll<HTMLButtonElement>(':scope > button:not(:disabled)')];
  if (buttons.length === 0) return;
  const index = buttons.findIndex((button) => button === active);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
}

export function close(): void {
  if (listenTimer !== null) clearTimeout(listenTimer);
  listenTimer = null;
  if (!current) return;
  const restoreFocus = current.contains(document.activeElement);
  current.remove();
  current = null;
  if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
  returnFocus = null;
  document.removeEventListener('pointerdown', onOutside, true);
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('blur', close);
  window.removeEventListener('wheel', close);
}
