import type { VPath } from '../core/vault/types';
import type { Suggestion } from '../core/index/Indexer';
import { ModalList, type ModalItem } from './modalList';

export interface QuickSwitcherOptions {
  items: () => Suggestion[];
  onOpen: (path: VPath) => void;
  onCreate: (name: string) => void;
}

const CREATE_ID = ' create';

/**
 * Ctrl+O で開くノート切替。
 * 名前の一部を打って Enter。無ければその名前で新規作成できる。
 */
export class QuickSwitcher {
  private readonly modal: ModalList;

  constructor(opts: QuickSwitcherOptions) {
    this.modal = new ModalList({
      placeholder: 'ノート名を入力（Enter で開く / 無ければ作成）',
      emptyMessage: 'ノートがありません',
      items: (query) => {
        const rows = rank(opts.items(), query);
        if (query !== '' && !rows.some((r) => r.title.toLowerCase() === query.toLowerCase())) {
          rows.push({ id: CREATE_ID, title: `「${query}」を新規作成`, className: 'create' });
        }
        return rows;
      },
      onSelect: (item, query) => {
        if (item.id === CREATE_ID) opts.onCreate(query);
        else opts.onOpen(item.id);
      },
    });
  }

  open(): void {
    this.modal.open();
  }

  close(): void {
    this.modal.close();
  }

  get isOpen(): boolean {
    return this.modal.isOpen;
  }
}

/** 完全一致 > 前方一致 > 部分一致 > タイトル > パス > 別名 */
function rank(items: Suggestion[], query: string): ModalItem[] {
  if (query === '') {
    return [...items]
      .sort((a, b) => a.basename.localeCompare(b.basename, 'ja', { numeric: true }))
      .map((s) => toItem(s));
  }

  const q = query.toLowerCase();
  const scored: { item: Suggestion; score: number; alias?: string }[] = [];

  for (const item of items) {
    const base = item.basename.toLowerCase();
    let score = -1;
    let alias: string | undefined;

    if (base === q) score = 100;
    else if (base.startsWith(q)) score = 80;
    else if (base.includes(q)) score = 60;
    else if (item.title.toLowerCase().includes(q)) score = 50;
    else if (item.path.toLowerCase().includes(q)) score = 40;
    else {
      const hit = item.aliases.find((a) => a.toLowerCase().includes(q));
      if (hit) {
        score = 30;
        alias = hit;
      }
    }

    if (score >= 0) {
      score -= item.path.split('/').length * 0.5;
      scored.push(alias !== undefined ? { item, score, alias } : { item, score });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score || a.item.basename.localeCompare(b.item.basename, 'ja'))
    .map((s) => toItem(s.item, s.alias));
}

function toItem(s: Suggestion, alias?: string): ModalItem {
  return {
    id: s.path,
    title: s.basename,
    subtitle: alias ? `${s.path}  ← ${alias}` : s.path,
  };
}
