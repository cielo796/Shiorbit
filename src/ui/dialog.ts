import { button, el } from './dom';

/**
 * アプリ内ダイアログ。
 *
 * window.prompt は Electron（Chromium）が実装を持たないため、
 * デスクトップ版では常に失敗する。入力を伴う確認は必ずここを通す。
 */
export interface DialogFrame {
  overlay: HTMLElement;
  body: HTMLElement;
  footer: HTMLElement;
  close: () => void;
}

/** 見出し・本文・ボタン列を持つ骨組みを作り、Esc と背景クリックで閉じられるようにする。 */
export function openDialog(title: string, className: string, onCancel: () => void): DialogFrame {
  const overlay = el('div', 'modal-overlay');
  const modal = el('div', `modal ${className}`);
  const body = el('div', 'dialog-body');
  const footer = el('div', 'settings-footer');

  modal.append(el('div', 'settings-title', title), body, footer);
  overlay.append(modal);

  const close = (): void => overlay.remove();
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) onCancel();
  });
  overlay.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  });

  document.body.append(overlay);
  return { overlay, body, footer, close };
}

export interface PromptOptions {
  title: string;
  label?: string;
  hint?: string;
  value?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** 入力が使えない理由を返す。null なら確定できる。 */
  validate?: (value: string) => string | null;
}

/** 1行の入力を受け取る。キャンセル時は null。 */
export function promptDialog(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: string | null): void => {
      if (done) return;
      done = true;
      frame.close();
      resolve(value);
    };

    const frame = openDialog(opts.title, 'dialog prompt-dialog', () => finish(null));

    const input = el('input', 'settings-input dialog-input');
    input.type = 'text';
    input.value = opts.value ?? '';
    if (opts.placeholder !== undefined) input.placeholder = opts.placeholder;
    if (opts.label !== undefined) input.setAttribute('aria-label', opts.label);

    const error = el('div', 'dialog-error');
    if (opts.label !== undefined) frame.body.append(el('div', 'dialog-label', opts.label));
    frame.body.append(input);
    if (opts.hint !== undefined) frame.body.append(el('div', 'dialog-hint', opts.hint));
    frame.body.append(error);

    const submit = button(opts.confirmLabel ?? '作成', 'primary', () => {
      if (!refresh()) return;
      finish(input.value.trim());
    });

    const refresh = (): boolean => {
      const value = input.value.trim();
      const reason = value === '' ? null : (opts.validate?.(value) ?? null);
      error.textContent = reason ?? '';
      const ok = value !== '' && reason === null;
      submit.disabled = !ok;
      return ok;
    };

    input.addEventListener('input', () => refresh());
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (refresh()) finish(input.value.trim());
    });

    frame.footer.append(button('キャンセル', undefined, () => finish(null)), submit);
    refresh();
    input.focus();
    input.select();
  });
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 取り消せない操作は赤で示す。 */
  danger?: boolean;
  /** 誤操作を避けるため、最初にキャンセルへフォーカスする。 */
  preferCancel?: boolean;
}

/** はい / いいえ を受け取る。 */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: boolean): void => {
      if (done) return;
      done = true;
      frame.close();
      resolve(value);
    };

    const frame = openDialog(opts.title, 'dialog confirm-dialog', () => finish(false));
    for (const line of opts.message.split('\n')) {
      frame.body.append(el('p', 'dialog-message', line));
    }

    const cancel = button(opts.cancelLabel ?? 'キャンセル', undefined, () => finish(false));
    const confirm = button(opts.confirmLabel ?? 'OK', opts.danger ? 'danger' : 'primary', () => finish(true));
    frame.footer.append(cancel, confirm);
    (opts.preferCancel ? cancel : confirm).focus();
  });
}
