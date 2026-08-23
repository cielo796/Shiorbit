import type { RenamePlan } from '../core/refactor/planRename';
import { button, el, noteLabel } from './dom';

/** 改名とリンク書き換えの影響範囲を表示し、明示確認を取る。 */
export function confirmRename(plan: RenamePlan): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = el('div', 'modal-overlay');
    const modal = el('div', 'modal rename-modal');
    const title = el('div', 'settings-title', 'ノート名を変更');
    const body = el('div', 'rename-body');
    body.append(
      el('div', 'rename-path', `${plan.from}  →  ${plan.to}`),
      el(
        'p',
        'rename-summary',
        plan.occurrenceCount === 0
          ? '書き換えが必要なリンクはありません。'
          : `${plan.files.length} 件のノートの ${plan.occurrenceCount} か所を書き換えます。`,
      ),
    );

    if (plan.files.length > 0) {
      const list = el('div', 'rename-files');
      for (const file of plan.files) {
        const row = el('div', 'rename-file');
        row.append(
          el('span', 'rename-file-name', noteLabel(file.path)),
          el('span', 'rename-file-path', file.path),
          el('span', 'pane-count', String(file.rewrites.length)),
        );
        list.append(row);
      }
      body.append(list);
    }

    const finish = (value: boolean): void => {
      overlay.remove();
      resolve(value);
    };
    const footer = el('div', 'settings-footer');
    footer.append(
      button('キャンセル', undefined, () => finish(false)),
      button('変更する', 'primary', () => finish(true)),
    );
    modal.append(title, body, footer);
    overlay.append(modal);
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) finish(false);
    });
    document.body.append(overlay);
  });
}
