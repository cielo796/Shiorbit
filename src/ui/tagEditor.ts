import { editManualTags, normalizeTag, type TagEdit } from '../core/notes/tags';
import { frontmatterTags, scanNote } from '../core/markdown/scan';
import type { VPath } from '../core/vault/types';
import { button, el } from './dom';
import { openDialog } from './dialog';

export interface TagEditorOptions {
  path: VPath;
  text: string;
  autoCollectTags: boolean;
  suggestions: string[];
  apply: (edit: TagEdit) => void;
}

/** 現在の Markdown の手動タグを追加・変更・削除する。本文由来のタグとは分けて見せる。 */
export function openTagEditor(opts: TagEditorOptions): void {
  const meta = scanNote(opts.path, opts.text, { mtime: 0, size: opts.text.length });
  const manualTags = frontmatterTags(meta.frontmatter);
  const tags = [...manualTags];
  const previousFocus = document.activeElement;
  const close = (): void => {
    frame.close();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  };
  const frame = openDialog('ノートのタグを編集', 'tag-editor', close);
  frame.overlay.querySelector('.modal')?.setAttribute('role', 'dialog');
  frame.overlay.querySelector('.modal')?.setAttribute('aria-modal', 'true');
  frame.overlay.querySelector('.modal')?.setAttribute('aria-label', 'ノートのタグを編集');
  const list = el('div', 'tag-editor-list');
  const error = el('div', 'dialog-error');
  error.setAttribute('role', 'alert');
  const input = el('input', 'settings-input dialog-input');
  input.placeholder = '例: ゲーム/BF6';
  input.setAttribute('aria-label', '追加するタグ');
  const suggest = el('datalist');
  suggest.id = 'tag-editor-suggestions';
  for (const tag of opts.suggestions) {
    const option = el('option');
    option.value = tag;
    suggest.append(option);
  }
  input.setAttribute('list', suggest.id);

  const render = (): void => {
    list.replaceChildren();
    if (!tags.length) list.append(el('div', 'dialog-hint', '手動タグはありません。'));
    tags.forEach((tag, i) => {
      const row = el('div', 'tag-editor-row');
      const name = el('input', 'settings-input');
      name.value = tag;
      name.setAttribute('aria-label', `タグ ${i + 1}`);
      name.addEventListener('input', () => { tags[i] = name.value; });
      row.append(name, button('削除', undefined, () => {
        tags.splice(i, 1);
        render();
        input.focus();
      }));
      list.append(row);
    });
  };
  const add = (): boolean => {
    try {
      const tag = normalizeTag(input.value);
      if (!tags.includes(tag)) tags.push(tag);
      input.value = '';
      error.textContent = '';
      render();
      input.focus();
      return true;
    } catch (e) {
      error.textContent = e instanceof Error ? e.message : String(e);
      return false;
    }
  };
  const addRow = el('div', 'tag-editor-row');
  addRow.append(input, button('追加', undefined, () => { add(); }), suggest);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); add(); }
  });
  frame.body.append(
    el('div', 'dialog-preview', opts.path),
    el('div', 'dialog-hint', 'このノートだけの手動タグを編集します。frontmatter の tags に保存されます。名前は各入力欄で変更できます。'),
    list, addRow,
    el('div', 'dialog-label', `本文からの追加候補（手動タグを除く・自動収集: ${opts.autoCollectTags ? 'ON' : 'OFF'}）`),
    el('div', 'dialog-preview', meta.tags.filter((tag) => !manualTags.includes(tag)).map((tag) => `#${tag}`).join('、') || 'なし'),
    el('div', 'dialog-hint', '本文の #タグ はここでは変更しません。自動収集のON/OFFは「設定 → タグ」で変更できます。手動から外しても本文に残っていれば自動収集されます。'),
    error,
  );
  frame.footer.append(button('キャンセル', undefined, close), button('適用', 'primary', () => {
    if (input.value.trim() && !add()) return;
    try {
      const edit = editManualTags(opts.text, tags);
      opts.apply(edit);
      close();
    } catch (e) {
      error.textContent = e instanceof Error ? e.message : String(e);
    }
  }));
  render();
  input.focus();
}
