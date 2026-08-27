import type { NoteContent } from '../../core/vault/VaultService';
import type { VPath } from '../../core/vault/types';
import { renderHtmlPreview } from '../htmlPreview';
import { MarkdownDocumentView } from './markdownView';
import type { DocumentContext, DocumentMode, DocumentViewState } from './DocumentView';

const MODES: readonly DocumentMode[] = [
  { id: 'preview', label: 'プレビュー' },
  { id: 'source', label: 'ソース' },
];

/**
 * HTML の表示。安全なプレビューと、編集できるソースを切り替える。
 *
 * プレビューは opaque origin の sandbox iframe なので、外から
 * スクロール位置を読み書きできない。位置合わせは見出しへのフラグメントだけ。
 */
export class HtmlDocumentView extends MarkdownDocumentView {
  override readonly usesMarkdownToolbar = false;
  override readonly modes: readonly DocumentMode[] = MODES;

  private mode: string;
  /** プレビューに送った見出し番号。ソースへ戻るときの手掛かりにする。 */
  private headingIndex = 0;

  constructor(path: VPath, ctx: DocumentContext) {
    super(path, ctx);
    this.mode = ctx.settings().htmlDefaultView;
  }

  override element(): HTMLElement {
    return this.mode === 'preview' ? this.ctx.surfaces.preview : this.ctx.surfaces.editor.dom;
  }

  override load(content: NoteContent): void {
    this.ctx.surfaces.editor.setLanguage('html');
    this.ctx.surfaces.editor.setDoc(content.text);
    this.mode = this.ctx.settings().htmlDefaultView;
    this.headingIndex = 0;
    this.renderPreview();
  }

  override applyExternal(content: NoteContent): void {
    super.applyExternal(content);
    this.renderPreview();
  }

  override reveal(offset: number): void {
    this.headingIndex = this.headingIndexAt(offset);
    // プレビュー中はソースへ切り替えず、プレビュー側を動かす。
    if (this.mode === 'preview') {
      this.renderPreview();
      return;
    }
    super.reveal(offset);
  }

  activeMode(): string {
    return this.mode;
  }

  setMode(id: string): void {
    if (id === this.mode) return;
    const previous = this.mode;
    this.mode = id;

    if (id === 'preview') {
      this.headingIndex = this.headingIndexAt(this.offset());
      this.renderPreview();
      return;
    }
    if (previous === 'preview') {
      // display:none の間にスクロール位置が失われるので、見出しへ寄せ直す。
      const heading = this.headings()[this.headingIndex];
      if (heading) super.reveal(heading.offset);
    }
  }

  override getState(): DocumentViewState {
    return { ...super.getState(), mode: this.mode };
  }

  override restoreState(state: DocumentViewState): void {
    super.restoreState(state);
    if (state.mode !== undefined) this.mode = state.mode;
    this.headingIndex = this.headingIndexAt(state.offset);
    if (this.mode === 'preview') this.renderPreview();
  }

  override focus(): void {
    if (this.mode === 'source') super.focus();
  }

  /** 入力のたびにプレビューを描き直す（ソースで編集しているとき用）。 */
  refreshPreview(): void {
    this.renderPreview();
  }

  private renderPreview(): void {
    renderHtmlPreview(this.ctx.surfaces.preview, this.ctx.surfaces.editor.getDoc(), {
      zoom: this.ctx.settings().zoom,
      headingIndex: this.headingIndex,
    });
  }

  /** offset の直前にある見出しの番号。見出しが無ければ 0。 */
  private headingIndexAt(offset: number): number {
    const headings = this.headings();
    let index = 0;
    for (let i = 0; i < headings.length; i++) {
      if (headings[i]!.offset > offset) break;
      index = i;
    }
    return index;
  }
}
