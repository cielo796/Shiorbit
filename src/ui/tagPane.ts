import type { VPath } from '../core/vault/types';
import { el, noteLabel } from './dom';

export interface TagPaneOptions {
  onOpen: (path: VPath) => void;
}

/** タグの一覧。クリックで、そのタグが付いたノートを開閉表示する。 */
export class TagPane {
  readonly dom: HTMLElement;
  private tags: Map<string, VPath[]> = new Map();
  private readonly expanded = new Set<string>();

  constructor(private readonly opts: TagPaneOptions) {
    this.dom = el('div', 'sidebar-body');
    this.setTags(new Map());
  }

  setTags(tags: Map<string, VPath[]>): void {
    this.tags = tags;
    this.render();
  }

  private render(): void {
    this.dom.replaceChildren();

    const entries = [...this.tags.entries()].sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'ja'),
    );

    if (entries.length === 0) {
      this.dom.append(
        el('div', 'pane-empty', 'タグがありません。本文に #タグ と書くか、frontmatter に tags を入れてください。'),
      );
      return;
    }

    for (const [tag, paths] of entries) {
      const row = el('div', 'tag-row');
      row.append(
        el('span', 'tag-name', `#${tag}`),
        el('span', 'pane-count', String(paths.length)),
      );
      row.addEventListener('click', () => {
        if (this.expanded.has(tag)) this.expanded.delete(tag);
        else this.expanded.add(tag);
        this.render();
      });
      this.dom.append(row);

      if (!this.expanded.has(tag)) continue;
      for (const path of [...paths].sort((a, b) => a.localeCompare(b, 'ja'))) {
        const child = el('div', 'tag-note', noteLabel(path));
        child.title = path;
        child.addEventListener('click', (e) => {
          e.stopPropagation();
          this.opts.onOpen(path);
        });
        this.dom.append(child);
      }
    }
  }
}
