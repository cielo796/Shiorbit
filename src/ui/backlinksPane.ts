import type { VPath } from '../core/vault/types';
import type { Backlink, OutLink } from '../core/index/Indexer';
import { linkDisplay } from '../core/markdown/wikilink';
import { el, noteLabel } from './dom';

export interface BacklinksPaneOptions {
  onOpen: (path: VPath, offset?: number) => void;
  onCreate: (name: string) => void;
}

/**
 * 右ペイン。「このノートを参照しているもの」と「このノートが参照しているもの」を出す。
 * 未解決リンクもここに並べる — まだ書いていないノートが一目で分かる。
 */
export class BacklinksPane {
  readonly dom: HTMLElement;

  constructor(private readonly opts: BacklinksPaneOptions) {
    this.dom = el('div', 'pane-stack');
    this.setNote(null, [], []);
  }

  setNote(path: VPath | null, backlinks: Backlink[], outgoing: OutLink[]): void {
    this.dom.replaceChildren();

    if (path === null) {
      this.dom.append(el('div', 'pane-empty', 'ノートを開くとリンク関係が出ます'));
      return;
    }

    this.dom.append(this.renderBacklinks(backlinks));
    this.dom.append(this.renderOutgoing(outgoing));
  }

  private renderBacklinks(backlinks: Backlink[]): HTMLElement {
    const section = el('section', 'pane-section');
    section.append(header('リンク元', backlinks.length));

    if (backlinks.length === 0) {
      section.append(el('div', 'pane-empty', 'このノートを参照しているノートはありません'));
      return section;
    }

    const byNote = new Map<VPath, Backlink[]>();
    for (const b of backlinks) {
      const list = byNote.get(b.from);
      if (list) list.push(b);
      else byNote.set(b.from, [b]);
    }

    for (const [from, list] of byNote) {
      const group = el('div', 'backlink-group');
      const title = el('div', 'backlink-source');
      title.textContent = noteLabel(from);
      title.title = from;
      title.addEventListener('click', () => this.opts.onOpen(from));
      group.append(title);

      for (const b of list) {
        const line = el('div', 'backlink-context', b.context || '(空行)');
        line.title = `${from} を開く`;
        line.addEventListener('click', () => this.opts.onOpen(from, b.ref.from));
        group.append(line);
      }
      section.append(group);
    }
    return section;
  }

  private renderOutgoing(outgoing: OutLink[]): HTMLElement {
    const section = el('section', 'pane-section');
    section.append(header('リンク先', outgoing.length));

    if (outgoing.length === 0) {
      section.append(el('div', 'pane-empty', 'このノートからのリンクはありません'));
      return section;
    }

    const seen = new Set<string>();
    for (const link of outgoing) {
      if (link.ref.target === '') continue;
      const key = `${link.ref.target}|${link.resolved ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const row = el('div', link.resolved ? 'outlink' : 'outlink unresolved');
      row.append(el('span', 'outlink-icon', link.resolved ? '→' : '＋'));
      row.append(el('span', 'outlink-label', linkDisplay(link.ref)));

      if (link.resolved) {
        const target = link.resolved;
        row.title = `${target} を開く`;
        row.addEventListener('click', () => this.opts.onOpen(target));
      } else {
        const name = link.ref.target;
        row.title = `「${name}」を新規作成`;
        row.addEventListener('click', () => this.opts.onCreate(name));
      }
      section.append(row);
    }
    return section;
  }
}

function header(label: string, count: number): HTMLElement {
  const h = el('div', 'pane-header');
  h.append(el('span', undefined, label), el('span', 'pane-count', String(count)));
  return h;
}
