import { isCanvasReadable, parseCanvas, stringifyCanvas } from '../../core/canvas/parse';
import type { CanvasData } from '../../core/canvas/types';
import type { Heading } from '../../core/markdown/scan';
import type { NoteContent } from '../../core/vault/VaultService';
import type { VPath } from '../../core/vault/types';
import type { DocumentContext, DocumentView, DocumentViewState } from './DocumentView';

/** JSON として読めないファイルを開こうとしたときのしるし。 */
export class UnreadableCanvasError extends Error {
  constructor(path: VPath) {
    super(`${path} は JSON として読めません。開かずにおきます。`);
    this.name = 'UnreadableCanvasError';
  }
}

/**
 * `.canvas` のホワイトボード。
 *
 * 読めないファイルは開かない — 空のキャンバスとして開くと、
 * 次の自動保存で中身を消してしまうため。
 */
export class CanvasDocumentView implements DocumentView {
  private data: CanvasData | null = null;

  constructor(
    readonly path: VPath,
    private readonly ctx: DocumentContext,
  ) {}

  element(): HTMLElement {
    return this.ctx.surfaces.canvas.dom;
  }

  load(content: NoteContent): void {
    if (!isCanvasReadable(content.text)) throw new UnreadableCanvasError(this.path);
    this.data = parseCanvas(content.text);
    const canvas = this.ctx.surfaces.canvas;
    canvas.bind((next) => {
      this.data = next;
      this.ctx.markDirty();
    });
    canvas.setData(this.data);
    canvas.fit();
  }

  contentToSave(): string | null {
    return this.data === null ? null : stringifyCanvas(this.data);
  }

  applyExternal(content: NoteContent): void {
    this.load(content);
  }

  headings(): Heading[] {
    return [];
  }

  offset(): number {
    return 0;
  }

  reveal(): void {
    /* 盤面には行番号が無い */
  }

  getState(): DocumentViewState {
    return { offset: 0, scrollTop: 0 };
  }

  restoreState(): void {
    /* 開くたびに全体を収める */
  }

  focus(): void {
    this.ctx.surfaces.canvas.dom.focus();
  }

  destroy(): void {
    this.ctx.surfaces.canvas.bind(null);
  }
}
