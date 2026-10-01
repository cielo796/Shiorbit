import type { Heading } from '../../core/markdown/scan';
import type { NoteContent } from '../../core/vault/VaultService';
import type { VPath } from '../../core/vault/types';
import type { DocumentContext, DocumentMode, DocumentView, DocumentViewState } from './DocumentView';

/**
 * Markdown の編集画面。
 * 面（CodeMirror）は DocumentArea から借りるだけで、View は状態を持たない。
 */
export class MarkdownDocumentView implements DocumentView {
  readonly mobileToolbarLanguage: 'markdown' | 'html' = 'markdown';
  readonly modes?: readonly DocumentMode[];

  constructor(
    readonly path: VPath,
    protected readonly ctx: DocumentContext,
  ) {}

  element(): HTMLElement {
    return this.ctx.surfaces.editor.dom;
  }

  load(content: NoteContent): void {
    this.ctx.surfaces.editor.setLanguage('markdown');
    this.ctx.surfaces.editor.setDoc(content.text);
  }

  contentToSave(): string | null {
    return this.ctx.surfaces.editor.getDoc();
  }

  applyExternal(content: NoteContent): void {
    // 読んでいた場所は保つ。外部の変更で先頭へ飛ばされないため。
    const editor = this.ctx.surfaces.editor;
    editor.setDoc(content.text, editor.getViewState());
  }

  headings(): Heading[] {
    return this.ctx.headingsOf(this.path);
  }

  offset(): number {
    return this.ctx.surfaces.editor.getViewState().anchor;
  }

  reveal(offset: number): void {
    this.ctx.surfaces.editor.revealOffset(offset);
  }

  getState(): DocumentViewState {
    const view = this.ctx.surfaces.editor.getViewState();
    return { offset: view.anchor, scrollTop: view.scrollTop };
  }

  restoreState(state: DocumentViewState): void {
    this.ctx.surfaces.editor.setViewState({
      anchor: state.offset,
      head: state.offset,
      scrollTop: state.scrollTop,
    });
  }

  focus(): void {
    this.ctx.surfaces.editor.focus();
  }

  destroy(): void {
    /* 面は使い回すので、ここで壊すものは無い */
  }
}
