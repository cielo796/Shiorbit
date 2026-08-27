import { el } from './dom';

export interface MenuItem {
  label: string;
  /** false なら灰色にして押せなくする（項目自体は消さない） */
  enabled?: boolean;
  run: () => void;
}

/**
 * 右クリックで出す小さなメニュー。
 *
 * モーダルではないので、外側を押す・Esc・スクロールのどれでも閉じる。
 * 位置は指定された点に合わせ、画面からはみ出す分だけ内側へ寄せる。
 */
export function openContextMenu(x: number, y: number, items: readonly MenuItem[]): void {
  if (items.length === 0) return;
  close();

  const menu = el('div', 'context-menu');
  menu.setAttribute('role', 'menu');

  for (const item of items) {
    const button = el('button', 'context-menu-item', item.label);
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    if (item.enabled === false) {
      button.disabled = true;
    } else {
      button.addEventListener('click', () => {
        close();
        item.run();
      });
    }
    menu.append(button);
  }

  document.body.append(menu);

  // 大きさは置いてみないと分からないので、付けてから位置を決める。
  const rect = menu.getBoundingClientRect();
  const left = Math.max(4, Math.min(x, window.innerWidth - rect.width - 4));
  const top = Math.max(4, Math.min(y, window.innerHeight - rect.height - 4));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  current = menu;
  // 開いたクリックそのもので閉じないよう、次の順番から見張る。
  setTimeout(() => {
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close);
    window.addEventListener('wheel', close, { passive: true });
  }, 0);
}

let current: HTMLElement | null = null;

function onOutside(event: PointerEvent): void {
  if (current && event.target instanceof Node && current.contains(event.target)) return;
  close();
}

function onKey(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  close();
}

export function close(): void {
  if (!current) return;
  current.remove();
  current = null;
  document.removeEventListener('pointerdown', onOutside, true);
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('blur', close);
  window.removeEventListener('wheel', close);
}
