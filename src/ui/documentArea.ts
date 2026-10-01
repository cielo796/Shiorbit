import type { Indexer } from '../core/index/Indexer';
import type { Heading } from '../core/markdown/scan';
import type { SettingsData } from '../core/settings/Settings';
import { ConflictError } from '../core/vault/errors';
import { isBase, isCanvas, isHtml, isSupportedDocument } from '../core/vault/path';
import type { NoteContent, VaultService } from '../core/vault/VaultService';
import type { VPath } from '../core/vault/types';
import { el } from './dom';
import { clearHtmlPreview } from './htmlPreview';
import { resolveConflict } from './conflictDialog';
import type {
  DocumentContext,
  DocumentMode,
  DocumentSurfaces,
  DocumentView,
  DocumentViewState,
} from './views/DocumentView';
import { BaseDocumentView } from './views/baseView';
import { CanvasDocumentView } from './views/canvasDocumentView';
import { HtmlDocumentView } from './views/htmlView';
import { MarkdownDocumentView } from './views/markdownView';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface DocumentAreaOptions {
  vault: VaultService;
  index: () => Indexer | null;
  settings: () => SettingsData;
  surfaces: DocumentSurfaces;
  /** 空のときに出す案内 */
  placeholder: HTMLElement;
  onSaveState: (state: SaveState) => void;
  /** 開いている文書が変わった（タイトル・ツリーの選択・右ペインの更新用） */
  onChanged: () => void;
  /** 表示の切り替え候補が変わった（HTML のモードボタン用） */
  onModesChanged: (modes: readonly DocumentMode[], active: string | null) => void;
  toast: (message: string, isError?: boolean) => void;
}

/**
 * ドキュメントを1つ表示する領域。
 *
 * 種類ごとの違いは View 実装に閉じ込め、ここは
 * 「開く・保存する・位置を戻す」の手順だけを持つ。
 * ペインを増やすとき（Phase 8）は、これをペインの数だけ作る。
 */
export class DocumentArea {
  readonly dom: HTMLElement;
  private view: DocumentView | null = null;
  private baseMtime = 0;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** 文書ごとに読んでいた場所。切り替えて戻っても先頭に飛ばされないようにする。 */
  private readonly states = new Map<VPath, DocumentViewState>();
  private readonly ctx: DocumentContext;

  constructor(private readonly opts: DocumentAreaOptions) {
    this.dom = el('div', 'editor-host');
    this.ctx = {
      surfaces: opts.surfaces,
      settings: opts.settings,
      headingsOf: (path) => opts.index()?.getMeta(path)?.headings ?? [],
      allMeta: () => opts.index()?.allMeta() ?? [],
      readBinary: (path) => opts.vault.readBinary(path),
      markDirty: () => this.markDirty(),
    };

    this.dom.append(
      opts.placeholder,
      opts.surfaces.editor.dom,
      opts.surfaces.preview,
      opts.surfaces.bases.dom,
      opts.surfaces.canvas.dom,
    );
    this.showOnly(null);
  }

  get path(): VPath | null {
    return this.view?.path ?? null;
  }

  /** この領域が使っている面。ペインごとに別の組になる。 */
  get surfaces(): DocumentSurfaces {
    return this.opts.surfaces;
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  /** プレビュー中の HTML は、未初期化の共用エディタではなく文書から読む。 */
  get documentText(): string | null {
    return this.view?.contentToSave() ?? null;
  }

  get mobileToolbarLanguage(): 'markdown' | 'html' | null {
    return this.view?.mobileToolbarLanguage ?? null;
  }

  headings(): Heading[] {
    return this.view?.headings() ?? [];
  }

  offset(): number {
    return this.view?.offset() ?? 0;
  }

  /** この文書が開ける形式か。開く前に呼んで案内を出せるようにする。 */
  static canOpen(path: VPath): boolean {
    return isSupportedDocument(path) || isBase(path) || isCanvas(path);
  }

  async open(path: VPath, offset?: number): Promise<boolean> {
    if (!DocumentArea.canOpen(path)) {
      this.opts.toast(`${path} は未対応のファイル形式です。`, true);
      return false;
    }

    if (this.dirty) await this.saveNow();
    this.remember();

    let content: NoteContent;
    try {
      content = await this.opts.vault.readNote(path);
    } catch (e) {
      this.opts.toast(message(e), true);
      return false;
    }

    // 読み込みの前に差し替える。装飾（Live Preview やリンク）は
    // 「いまどの文書か」を見て組み立てるので、古い文書のままだと合わなくなる。
    const previous = this.view;
    const next = this.createView(path);
    this.view = next;

    try {
      await next.load(content);
    } catch (e) {
      // 読めなかったものは開かない。空で開くと次の保存で中身を消してしまう。
      this.view = previous;
      this.opts.toast(message(e), true);
      return false;
    }

    previous?.destroy();
    this.baseMtime = content.mtime;
    this.dirty = false;

    const saved = offset === undefined ? this.states.get(path) : undefined;
    if (saved) next.restoreState(saved);

    this.showOnly(next);
    this.opts.onSaveState('idle');
    this.opts.onChanged();

    if (offset !== undefined) next.reveal(offset);
    else next.focus();
    return true;
  }

  close(): void {
    this.cancelSave();
    this.view?.destroy();
    this.view = null;
    this.dirty = false;
    this.opts.surfaces.editor.setDoc('');
    clearHtmlPreview(this.opts.surfaces.preview);
    this.showOnly(null);
    this.opts.onSaveState('idle');
    this.opts.onChanged();
  }

  /** 開いていた文書を忘れる（削除されたときなど）。 */
  forget(path: VPath): void {
    this.states.delete(path);
    if (this.view?.path === path) this.close();
  }

  forgetAll(): void {
    this.states.clear();
  }

  reveal(offset: number): void {
    this.view?.reveal(offset);
  }

  focus(): void {
    this.view?.focus();
  }

  activeMode(): string | null {
    return this.view?.activeMode?.() ?? null;
  }

  setMode(id: string): void {
    const view = this.view;
    if (!view?.setMode) return;
    view.setMode(id);
    this.showOnly(view);
    this.opts.onChanged();
  }

  /** 索引が変わったときに、表など「他のノートを見ている」View を引き直す。 */
  refreshDerived(): void {
    if (this.view instanceof BaseDocumentView) this.view.refresh();
  }

  /** 編集が入った。自動保存を仕込む。 */
  markDirty(): void {
    if (this.view instanceof HtmlDocumentView) this.view.refreshPreview();
    this.dirty = true;
    this.opts.onSaveState('dirty');
    this.cancelSave();
    this.saveTimer = setTimeout(() => void this.saveNow(), this.opts.settings().autoSaveDelay);
  }

  async saveNow(): Promise<void> {
    this.cancelSave();
    const view = this.view;
    if (!view || !this.dirty) return;

    const text = view.contentToSave();
    if (text === null) {
      this.dirty = false;
      return;
    }

    this.opts.onSaveState('saving');
    try {
      this.baseMtime = await this.opts.vault.writeNote(view.path, text, this.baseMtime);
      this.dirty = false;
      this.opts.onSaveState('saved');
      await this.opts.index()?.updateNote(view.path);
    } catch (e) {
      if (e instanceof ConflictError) await this.handleConflict(view.path, text);
      else {
        this.opts.onSaveState('error');
        this.opts.toast(message(e), true);
      }
    }
  }

  /** 外部で変わったファイルを取り込む。編集中なら取り込まず、保存時に確認する。 */
  async applyExternalChange(path: VPath): Promise<void> {
    if (this.view?.path !== path) return;
    if (this.dirty) {
      this.opts.toast('このノートは外部でも変更されています。保存時に確認します。', true);
      return;
    }

    try {
      const fresh = await this.opts.vault.readNote(path);
      this.view.applyExternal(fresh);
      this.baseMtime = fresh.mtime;
      this.showOnly(this.view);
      this.opts.toast('外部の変更を読み込みました。');
    } catch (e) {
      this.opts.toast(message(e), true);
    }
  }

  destroy(): void {
    this.cancelSave();
    this.view?.destroy();
    this.view = null;
    this.states.clear();
    // 面はこの領域のものなので、ここで畳む（CodeMirror を置き去りにしない）。
    this.opts.surfaces.editor.destroy();
    clearHtmlPreview(this.opts.surfaces.preview);
  }

  // ----------------------------------------------------------------- 内部

  private createView(path: VPath): DocumentView {
    if (isBase(path)) return new BaseDocumentView(path, this.ctx);
    if (isCanvas(path)) return new CanvasDocumentView(path, this.ctx);
    if (isHtml(path)) return new HtmlDocumentView(path, this.ctx);
    return new MarkdownDocumentView(path, this.ctx);
  }

  private remember(): void {
    if (this.view) this.states.set(this.view.path, this.view.getState());
  }

  private cancelSave(): void {
    if (this.saveTimer === null) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
  }

  /** View が選んだ面だけを見せる。 */
  private showOnly(view: DocumentView | null): void {
    const shown = view?.element() ?? null;
    const surfaces = this.opts.surfaces;
    if (shown !== surfaces.preview && (surfaces.preview.hasAttribute('src') || surfaces.preview.srcdoc !== '')) {
      clearHtmlPreview(surfaces.preview);
    }
    for (const element of [surfaces.editor.dom, surfaces.preview, surfaces.bases.dom, surfaces.canvas.dom]) {
      element.style.display = element === shown ? '' : 'none';
    }
    this.opts.placeholder.style.display = view === null ? '' : 'none';
    this.opts.onModesChanged(view?.modes ?? [], view?.activeMode?.() ?? null);
  }

  /**
   * 競合の解決（設計書 §9）。
   * どちらを選んでも、失われる側は必ず .conflict ファイルとして残す。
   */
  private async handleConflict(path: VPath, mine: string): Promise<void> {
    const vault = this.opts.vault;

    let external: NoteContent;
    try {
      external = await vault.readNote(path);
    } catch (e) {
      this.opts.onSaveState('error');
      this.opts.toast(message(e), true);
      return;
    }

    const choice = await resolveConflict({ path, mine, theirs: external.text });
    if (choice === 'cancel') {
      this.opts.onSaveState('dirty');
      this.opts.toast('競合の解決を取り消しました。保存はしていません。', true);
      return;
    }

    try {
      if (choice === 'mine') {
        const backup = await vault.saveConflictCopy(path, external.text);
        this.baseMtime = await vault.overwriteNote(path, mine);
        this.dirty = false;
        this.opts.onSaveState('saved');
        this.opts.toast(`保存しました。外部の内容は ${backup} に退避しています。`);
      } else {
        const backup = await vault.saveConflictCopy(path, mine);
        const fresh = await vault.readNote(path);
        this.view?.applyExternal(fresh);
        this.baseMtime = fresh.mtime;
        this.dirty = false;
        this.opts.onSaveState('saved');
        this.opts.toast(`外部の内容を読み込みました。自分の変更は ${backup} に退避しています。`);
      }
      if (this.view) this.showOnly(this.view);
      await this.opts.index()?.updateNote(path);
      this.opts.onChanged();
    } catch (e) {
      this.opts.onSaveState('error');
      this.opts.toast(message(e), true);
    }
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
