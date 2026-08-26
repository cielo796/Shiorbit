import type { NewDocumentKind, NewDocumentPlan } from '../core/notes/newDocument';
import { invalidNameReason, resolveNewDocument } from '../core/notes/newDocument';
import type { VPath } from '../core/vault/types';
import { button, el } from './dom';
import { openDialog } from './dialog';

export interface NewDocumentDialogOptions {
  /** 作成先フォルダ。'' は Vault のルート。 */
  baseDir: VPath;
  defaultKind?: NewDocumentKind;
}

const KINDS: Array<{ id: NewDocumentKind; label: string }> = [
  { id: 'markdown', label: 'Markdown' },
  { id: 'html', label: 'HTML' },
  { id: 'base', label: 'Base' },
  { id: 'folder', label: 'フォルダ' },
];

/**
 * 種別と名前を受け取り、作られるパスをその場で見せる。
 *
 * 「どこに何ができるか」を押す前に確定させたいので、
 * 入力のたびに resolveNewDocument を通した結果を表示する。
 */
export function askNewDocument(opts: NewDocumentDialogOptions): Promise<NewDocumentPlan | null> {
  return new Promise((resolve) => {
    let kind: NewDocumentKind = opts.defaultKind ?? 'markdown';
    let done = false;
    const finish = (plan: NewDocumentPlan | null): void => {
      if (done) return;
      done = true;
      frame.close();
      resolve(plan);
    };

    const frame = openDialog('新規作成', 'dialog new-document-dialog', () => finish(null));

    const kinds = el('div', 'dialog-kinds');
    kinds.setAttribute('role', 'group');
    kinds.setAttribute('aria-label', '作成する種別');
    const kindButtons = new Map<NewDocumentKind, HTMLButtonElement>();
    for (const choice of KINDS) {
      const b = button(choice.label, 'dialog-kind', () => {
        kind = choice.id;
        refresh();
        input.focus();
      });
      b.type = 'button';
      kindButtons.set(choice.id, b);
      kinds.append(b);
    }

    const input = el('input', 'settings-input dialog-input');
    input.type = 'text';
    input.placeholder = '例: AI/Ollama';
    input.setAttribute('aria-label', '名前');

    const preview = el('div', 'dialog-preview');
    const error = el('div', 'dialog-error');

    frame.body.append(
      kinds,
      el('div', 'dialog-label', '名前'),
      input,
      el('div', 'dialog-hint', 'スラッシュでフォルダも一緒に作れます。'),
      preview,
      error,
    );

    const submit = button('作成', 'primary', () => {
      const plan = current();
      if (plan) finish(plan);
    });

    const current = (): NewDocumentPlan | null => {
      if (invalidNameReason(input.value) !== null) return null;
      return resolveNewDocument(input.value, kind, opts.baseDir);
    };

    const refresh = (): void => {
      for (const [id, b] of kindButtons) {
        const active = id === kind;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', String(active));
      }

      const reason = invalidNameReason(input.value);
      error.textContent = reason ?? '';
      const plan = reason === null ? resolveNewDocument(input.value, kind, opts.baseDir) : null;
      preview.textContent = plan === null
        ? (opts.baseDir === '' ? 'Vault のルートに作成します。' : `${opts.baseDir}/ に作成します。`)
        : `作成先: ${plan.path}`;
      submit.disabled = plan === null;
    };

    input.addEventListener('input', () => refresh());
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const plan = current();
      if (plan) finish(plan);
    });

    frame.footer.append(button('キャンセル', undefined, () => finish(null)), submit);
    refresh();
    input.focus();
  });
}
