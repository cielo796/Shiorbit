import { columnLabel, formatValue, runQuery } from '../core/bases/query';
import type { BaseDefinition, BaseSort } from '../core/bases/types';
import type { NoteMeta } from '../core/markdown/scan';
import type { VPath } from '../core/vault/types';
import { el } from './dom';

export interface BasesViewOptions {
  onOpen: (path: VPath) => void;
}

/**
 * `.base` の表。v1 は読み取り専用。
 *
 * セル編集を入れると「表の編集 → frontmatter の書き戻し → 再インデックス」の
 * 往復に競合処理まで絡むので、要望が出てから設計する（PHASE5.md §3 5.4）。
 */
export class BasesView {
  readonly dom: HTMLElement;
  private base: BaseDefinition | null = null;
  private notes: readonly NoteMeta[] = [];
  /** 列ヘッダで切り替えた並び。定義の sort より優先する。 */
  private override: BaseSort | null = null;

  constructor(private readonly opts: BasesViewOptions) {
    this.dom = el('div', 'bases-view');
  }

  setBase(base: BaseDefinition | null, notes: readonly NoteMeta[]): void {
    // 別の .base を開いたら、前の表の並び替えは持ち込まない。
    if (base?.name !== this.base?.name) this.override = null;
    this.base = base;
    this.notes = notes;
    this.render();
  }

  /** インデックスが変わったら行だけ作り直す。 */
  setNotes(notes: readonly NoteMeta[]): void {
    this.notes = notes;
    this.render();
  }

  private sortOf(): BaseSort | undefined {
    return this.override ?? this.base?.sort;
  }

  private toggleSort(property: string): void {
    const current = this.sortOf();
    this.override = current?.property === property && current.order === 'asc'
      ? { property, order: 'desc' }
      : { property, order: 'asc' };
    this.render();
  }

  private render(): void {
    this.dom.replaceChildren();
    const base = this.base;
    if (!base) return;

    const head = el('div', 'bases-head');
    head.append(el('div', 'bases-name', base.name || '(名前のない Base)'));
    this.dom.append(head);

    if (base.columns.length === 0) {
      this.dom.append(el('div', 'pane-empty', 'columns が空です。表示する列を .base に書いてください。'));
      return;
    }

    const sort = this.sortOf();
    const rows = runQuery(sort ? { ...base, sort } : base, this.notes);
    head.append(el('div', 'bases-count', `${rows.length} 件`));

    const table = el('table', 'bases-table');
    const thead = el('thead');
    const headRow = el('tr');
    for (const column of base.columns) {
      const th = el('th');
      const button = el('button', 'bases-sort');
      button.type = 'button';
      button.textContent = columnLabel(column.property, column.label);
      if (sort?.property === column.property) {
        button.append(el('span', 'bases-arrow', sort.order === 'asc' ? '▲' : '▼'));
      }
      button.addEventListener('click', () => this.toggleSort(column.property));
      th.append(button);
      headRow.append(th);
    }
    thead.append(headRow);

    const tbody = el('tbody');
    for (const row of rows) {
      const tr = el('tr', 'bases-row');
      tr.tabIndex = 0;
      tr.title = row.path;
      row.cells.forEach((cell, i) => {
        const property = base.columns[i]!.property;
        tr.append(el('td', undefined, formatValue(property, cell)));
      });
      tr.addEventListener('click', () => this.opts.onOpen(row.path));
      tr.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        this.opts.onOpen(row.path);
      });
      tbody.append(tr);
    }

    table.append(thead, tbody);
    const scroller = el('div', 'bases-scroll');
    scroller.append(table);
    this.dom.append(scroller);

    if (rows.length === 0) {
      this.dom.append(el('div', 'pane-empty', '条件に合うノートがありません。'));
    }
  }
}
