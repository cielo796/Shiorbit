import { defaultBase, parseBase } from '../../core/bases/parse';
import type { BaseDefinition } from '../../core/bases/types';
import type { Heading } from '../../core/markdown/scan';
import { basename } from '../../core/vault/path';
import type { NoteContent } from '../../core/vault/VaultService';
import type { VPath } from '../../core/vault/types';
import type { DocumentContext, DocumentView, DocumentViewState } from './DocumentView';

/**
 * `.base` の表。v1 は読み取り専用なので、保存するものを持たない。
 * 定義が壊れていても既定の列で開き、書き直す余地を残す。
 */
export class BaseDocumentView implements DocumentView {
  private base: BaseDefinition | null = null;

  constructor(
    readonly path: VPath,
    private readonly ctx: DocumentContext,
  ) {}

  element(): HTMLElement {
    return this.ctx.surfaces.bases.dom;
  }

  load(content: NoteContent): void {
    const name = basename(this.path, true);
    const parsed = parseBase(content.text);
    const fallback = defaultBase(name);
    this.base = {
      ...parsed,
      name: parsed.name === '' ? name : parsed.name,
      columns: parsed.columns.length > 0 ? parsed.columns : fallback.columns,
      ...(parsed.sort === undefined && parsed.columns.length === 0 ? { sort: fallback.sort } : {}),
    };
    this.refresh();
  }

  /** 索引が変わったら行だけ作り直す。 */
  refresh(): void {
    if (this.base) this.ctx.surfaces.bases.setBase(this.base, this.ctx.allMeta());
  }

  contentToSave(): string | null {
    return null;
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
    /* 表には移動先が無い */
  }

  getState(): DocumentViewState {
    return { offset: 0, scrollTop: 0 };
  }

  restoreState(): void {
    /* 表の並びは開くたびに定義から引き直す */
  }

  focus(): void {
    /* 行に自動でフォーカスは当てない */
  }

  destroy(): void {
    this.ctx.surfaces.bases.setBase(null, []);
  }
}
