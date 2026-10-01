import type { NoteContent } from '../../core/vault/VaultService';
import type { VPath } from '../../core/vault/types';
import { dirname, join, normalize } from '../../core/vault/path';
import { AttachmentUrlCache } from '../embed/attachmentUrl';
import { clearHtmlPreview, createHtmlPreviewResourceWithImages, renderHtmlPreview, type HtmlPreviewResource } from '../htmlPreview';
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
  override readonly mobileToolbarLanguage = 'html' as const;
  override readonly modes: readonly DocumentMode[] = MODES;

  private mode: string;
  /** プレビューに送った見出し番号。ソースへ戻るときの手掛かりにする。 */
  private headingIndex = 0;
  private readonly imageUrls: AttachmentUrlCache;
  private previewGeneration = 0;
  private previewResource: HtmlPreviewResource | null = null;
  private sourceText = '';
  private sourceLoaded = false;
  private previewOffset = 0;
  private rendered: { source: string; zoom: number; headingIndex: number } | null = null;

  constructor(path: VPath, ctx: DocumentContext) {
    super(path, ctx);
    this.mode = ctx.settings().htmlDefaultView;
    this.imageUrls = new AttachmentUrlCache((imagePath) => ctx.readBinary(imagePath));
  }

  override element(): HTMLElement {
    return this.mode === 'preview' ? this.ctx.surfaces.preview : this.ctx.surfaces.editor.dom;
  }

  override load(content: NoteContent): void {
    this.sourceText = content.text;
    this.sourceLoaded = false;
    this.rendered = null;
    this.mode = this.ctx.settings().htmlDefaultView;
    this.headingIndex = 0;
    this.previewOffset = 0;
    if (this.mode === 'source') this.ensureSource();
    else this.renderPreview();
  }

  override contentToSave(): string {
    return this.sourceLoaded ? this.ctx.surfaces.editor.getDoc() : this.sourceText;
  }

  override offset(): number {
    return this.mode === 'source' ? super.offset() : this.previewOffset;
  }

  override applyExternal(content: NoteContent): void {
    this.sourceText = content.text;
    if (this.sourceLoaded) super.applyExternal(content);
    this.renderPreview();
  }

  override reveal(offset: number): void {
    this.previewOffset = offset;
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
    if ((id !== 'preview' && id !== 'source') || id === this.mode) return;
    const previous = this.mode;
    const offset = this.offset();
    this.mode = id;

    if (id === 'preview') {
      this.previewOffset = offset;
      this.headingIndex = this.headingIndexAt(offset);
      this.renderPreview();
      return;
    }
    if (previous === 'preview') {
      this.previewGeneration++;
      this.rendered = null;
      clearHtmlPreview(this.ctx.surfaces.preview);
      this.previewResource?.dispose();
      this.previewResource = null;
      this.ensureSource();
      // display:none の間にスクロール位置が失われるので、見出しへ寄せ直す。
      const heading = this.headings()[this.headingIndex];
      super.reveal(heading?.offset ?? this.previewOffset);
    }
  }

  override getState(): DocumentViewState {
    return this.mode === 'source'
      ? { ...super.getState(), mode: this.mode }
      : { offset: this.previewOffset, scrollTop: 0, mode: this.mode };
  }

  override restoreState(state: DocumentViewState): void {
    if (state.mode === 'preview' || state.mode === 'source') this.setMode(state.mode);
    this.previewOffset = state.offset;
    if (this.mode === 'source') {
      this.ensureSource();
      super.restoreState(state);
    }
    this.headingIndex = this.headingIndexAt(state.offset);
    if (this.mode === 'preview') this.renderPreview();
  }

  override focus(): void {
    if (this.mode === 'source') super.focus();
  }

  /** 非表示のプレビューは作り直さず、切り替えた時に最新のソースを反映する。 */
  refreshPreview(): void {
    this.renderPreview();
  }

  private renderPreview(): void {
    if (this.mode !== 'preview') return;
    const source = this.contentToSave();
    const zoom = this.ctx.settings().zoom;
    if (this.rendered?.source === source && this.rendered.zoom === zoom
      && this.rendered.headingIndex === this.headingIndex) return;
    this.rendered = { source, zoom, headingIndex: this.headingIndex };
    const generation = ++this.previewGeneration;
    const options = {
      zoom,
      headingIndex: this.headingIndex,
    };
    // 解析と iframe の読み込みは一度だけ。画像解決を待つ間は UI に制御を返す。
    void createHtmlPreviewResourceWithImages(source, (src) => this.resolveImage(src), options).then((resource) => {
      if (generation !== this.previewGeneration) { resource.dispose(); return; }
      const frame = this.ctx.surfaces.preview;
      frame.removeAttribute('srcdoc');
      frame.src = resource.url;
      this.previewResource?.dispose();
      this.previewResource = resource;
    }).catch(() => {
      if (generation !== this.previewGeneration) return;
      this.rendered = null;
      renderHtmlPreview(this.ctx.surfaces.preview, source, options);
    });
  }

  private ensureSource(): void {
    if (this.sourceLoaded) return;
    this.sourceLoaded = true;
    this.ctx.surfaces.editor.setLanguage('html');
    this.ctx.surfaces.editor.setDoc(this.sourceText);
  }

  private async resolveImage(src: string): Promise<string | null> {
    const rawPath = src.split(/[?#]/, 1)[0] ?? '';
    let decoded: string;
    try {
      decoded = decodeURIComponent(rawPath);
    } catch {
      return null;
    }
    const path = decoded.startsWith('/')
      ? normalize(decoded.slice(1))
      : join(dirname(this.path), decoded);
    return path === '' ? null : this.imageUrls.get(path);
  }

  override destroy(): void {
    this.previewGeneration++;
    this.previewResource?.dispose();
    this.previewResource = null;
    this.imageUrls.clear();
    super.destroy();
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
