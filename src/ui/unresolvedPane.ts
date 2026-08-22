import type { VPath } from '../core/vault/types';
import type { UnresolvedGroup } from '../core/index/Indexer';
import { el, noteLabel } from './dom';

export interface UnresolvedPaneOptions {
  onCreate: (name: string) => void;
  onOpen: (path: VPath, offset?: number) => void;
}

/**
 * 未解決リンクの一覧。
 *
 * 「まだ書いていないノートへの言及」がそのまま次に書くべきもののリストになる。
 * 未解決リンクを一級市民として扱うのがこの設計の狙い (設計書 §5)。
 */
export class UnresolvedPane {
  readonly dom: HTMLElement;

  constructor(private readonly opts: UnresolvedPaneOptions) {
    this.dom = el('div', 'sidebar-body');
    this.setGroups([]);
  }

  setGroups(groups: UnresolvedGroup[]): void {
    this.dom.replaceChildren();

    const intro = el('div', 'pane-note', 'まだ存在しないノートへの言及です。クリックすると作成できます。');
    this.dom.append(intro);

    if (groups.length === 0) {
      this.dom.append(el('div', 'pane-empty', '未解決リンクはありません'));
      return;
    }

    for (const group of groups) {
      const row = el('div', 'unresolved-row');
      const name = el('span', 'unresolved-name', group.name);
      const count = el('span', 'pane-count', String(group.sources.length));
      row.append(el('span', 'outlink-icon', '＋'), name, count);
      row.title = `「${group.name}」を新規作成`;
      row.addEventListener('click', () => this.opts.onCreate(group.name));
      this.dom.append(row);

      for (const src of group.sources) {
        const from = el('div', 'unresolved-source', noteLabel(src.path));
        from.title = `${src.path}: ${src.context}`;
        from.addEventListener('click', (e) => {
          e.stopPropagation();
          this.opts.onOpen(src.path, src.ref.from);
        });
        this.dom.append(from);
      }
    }
  }
}
