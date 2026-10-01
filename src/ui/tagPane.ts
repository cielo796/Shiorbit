import type { VPath } from '../core/vault/types';
import { isMarkdown } from '../core/vault/path';
import { button, el, noteLabel } from './dom';

export interface TagPaneOptions {
  onOpen: (path: VPath) => void;
  onEdit?: () => void;
}

/** タグの一覧。クリックで、そのタグが付いたノートを開閉表示する。 */
export class TagPane {
  readonly dom: HTMLElement;
  private tags: Map<string, VPath[]> = new Map();
  private readonly expanded = new Set<string>();
  private active: VPath | null = null;

  constructor(private readonly opts: TagPaneOptions) {
    this.dom = el('div', 'sidebar-body');
    this.setTags(new Map());
  }

  setTags(tags: Map<string, VPath[]>): void {
    this.tags = tags;
    this.render();
  }

  setActive(path: VPath | null): void {
    this.active = path;
    this.render();
  }

  private render(): void {
    this.dom.replaceChildren();
    if (this.opts.onEdit) {
      const toolbar = el('div', 'tag-pane-toolbar');
      const edit = button('ノートのタグを編集', 'tag-edit-current', this.opts.onEdit);
      edit.disabled = !this.active || !isMarkdown(this.active);
      toolbar.append(edit, el('div', 'dialog-hint', edit.disabled ? 'Markdown ノートを開くと編集できます。' : this.active!));
      this.dom.append(toolbar);
    }

    const entries = [...this.tags.entries()].sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'ja'),
    );

    if (entries.length === 0) {
      this.dom.append(
        el('div', 'pane-empty', 'タグがありません。手動タグを追加するか、設定で自動収集をONにして本文に #タグ を書いてください。'),
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
