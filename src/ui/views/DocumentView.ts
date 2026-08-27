import type { Heading } from '../../core/markdown/scan';
import type { SettingsData } from '../../core/settings/Settings';
import type { NoteContent } from '../../core/vault/VaultService';
import type { VPath } from '../../core/vault/types';
import type { MarkdownEditor } from '../editor';
import type { BasesView } from '../basesView';
import type { CanvasView } from '../canvas/CanvasView';

/**
 * ドキュメントを表示する面。
 *
 * 面は1組だけ用意して、View が「どれを使うか」を決める。
 * ペインを増やすとき（Phase 8）は、この1組を持つ DocumentArea を
 * ペインの数だけ作れば済むようにしてある。
 */
export interface DocumentSurfaces {
  editor: MarkdownEditor;
  preview: HTMLIFrameElement;
  bases: BasesView;
  canvas: CanvasView;
}

export interface DocumentContext {
  surfaces: DocumentSurfaces;
  settings: () => SettingsData;
  /** 見出しなどのメタ情報。索引が無い場面もあるので毎回問い合わせる。 */
  headingsOf: (path: VPath) => Heading[];
  /** Bases が引く、索引に載っているノート全部。 */
  allMeta: () => Parameters<BasesView['setBase']>[1];
  /** 中身が変わった。保存は DocumentArea が受け持つ。 */
  markDirty: () => void;
}

/** 開き直したときに戻す位置。中身は View ごとに違ってよい。 */
export interface DocumentViewState {
  offset: number;
  scrollTop: number;
  /** View 固有の状態（HTML の表示モードなど） */
  mode?: string;
}

export interface DocumentMode {
  id: string;
  label: string;
}

/**
 * 1つのドキュメントの見せ方。
 *
 * App はどの種類かを知らない。開く・保存する・位置を戻す、だけを呼ぶ。
 */
export interface DocumentView {
  readonly path: VPath;

  /** 表示に使う要素。DocumentArea がこれだけを表に出す。 */
  element(): HTMLElement;

  load(content: NoteContent): Promise<void> | void;

  /** 自動保存で書き出す内容。null は「保存するものが無い」（読み取り専用）。 */
  contentToSave(): string | null;

  /** 外部で変更されたときの取り込み。 */
  applyExternal(content: NoteContent): void;

  headings(): Heading[];
  offset(): number;
  reveal(offset: number): void;

  getState(): DocumentViewState;
  restoreState(state: DocumentViewState): void;

  focus(): void;
  destroy(): void;

  /** 表示の切り替え（HTML のプレビュー / ソースなど）。無い View は undefined。 */
  readonly modes?: readonly DocumentMode[];
  activeMode?(): string;
  setMode?(id: string): void;

  /** スマホの Markdown ツールバーを出すか。 */
  readonly usesMarkdownToolbar?: boolean;
}
