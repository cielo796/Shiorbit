import type { VPath } from '../core/vault/types';
import type { DocumentPane } from './documentPane';
import { el } from './dom';

export interface WorkspacePanesOptions {
  /** ペインを1つ作る。面（CodeMirror など）もペインごとに1組。 */
  createPane: (onFocus: () => void, onTabsChanged: () => void) => DocumentPane;
  /** 構成が変わった（開いたタブ・分割・選択）。保存し直す合図。 */
  onChanged: () => void;
}

export interface WorkspaceLayout {
  panes: Array<{ tabs: VPath[]; active: VPath | null }>;
  activePane: number;
}

/** 開く先。`other` は分割していなければ分割してから開く。 */
export type OpenTarget = 'active' | 'other';

const MAX_PANES = 2;

/**
 * 分割ペイン（設計書 §8）。縦2分割まで。
 *
 * **同じノートを2つのペインで同時に編集させない。**
 * CodeMirror は1つの EditorState を複数 View で共有できないので、
 * すでに開いているノートを別のペインで開くときは「移す」ことにしてある。
 * 同時編集は要望が出てから設計する（ROADMAP 8.2）。
 */
export class WorkspacePanes {
  readonly dom: HTMLElement;
  private readonly panes: DocumentPane[] = [];
  private activeIndex = 0;

  constructor(private readonly opts: WorkspacePanesOptions) {
    this.dom = el('div', 'document-panes');
    this.panes.push(this.make());
    this.dom.append(this.panes[0]!.dom);
    this.syncActive();
  }

  get active(): DocumentPane {
    return this.panes[this.activeIndex] ?? this.panes[0]!;
  }

  get isSplit(): boolean {
    return this.panes.length > 1;
  }

  get all(): readonly DocumentPane[] {
    return this.panes;
  }

  get path(): VPath | null {
    return this.active.path;
  }

  async open(path: VPath, offset?: number, target: OpenTarget = 'active'): Promise<void> {
    if (target === 'other' && !this.isSplit) this.split();

    const pane = target === 'other' ? this.other() : this.active;
    // 別のペインで開いていたら、そちらから外してから移す。
    for (const other of this.panes) {
      if (other !== pane && other.has(path)) other.forget(path);
    }

    this.setActive(this.panes.indexOf(pane));
    await pane.open(path, offset);
  }

  split(): void {
    if (this.panes.length >= MAX_PANES) return;
    const pane = this.make();
    this.panes.push(pane);
    this.dom.append(pane.dom);
    this.dom.classList.add('split');
    this.syncActive();
    this.opts.onChanged();
  }

  /** 分割を解く。閉じるほうのタブは残っているペインへ引き継ぐ。 */
  async unsplit(): Promise<void> {
    if (!this.isSplit) return;
    const closing = this.panes.pop()!;
    const keep = this.panes[0]!;

    const moved = [...closing.openPaths];
    closing.destroy();
    closing.dom.remove();
    this.dom.classList.remove('split');

    for (const path of moved) {
      if (!keep.has(path)) await keep.open(path);
    }
    this.setActive(0);
    this.opts.onChanged();
  }

  toggleSplit(): void {
    if (this.isSplit) void this.unsplit();
    else this.split();
  }

  /** もう片方のペインへ移る。分割していなければ何もしない。 */
  focusOther(): void {
    if (!this.isSplit) return;
    this.setActive((this.activeIndex + 1) % this.panes.length);
    this.active.area.focus();
  }

  forget(path: VPath): void {
    for (const pane of this.panes) {
      if (pane.has(path)) pane.forget(path);
    }
  }

  async saveAll(): Promise<void> {
    for (const pane of this.panes) await pane.area.saveNow();
  }

  get isDirty(): boolean {
    return this.panes.some((pane) => pane.area.isDirty);
  }

  refreshTabs(): void {
    for (const pane of this.panes) pane.refreshTabs();
  }

  serialize(): WorkspaceLayout {
    return {
      panes: this.panes.map((pane) => ({ tabs: [...pane.openPaths], active: pane.path })),
      activePane: this.activeIndex,
    };
  }

  async restore(layout: WorkspaceLayout): Promise<void> {
    while (this.panes.length > Math.max(1, Math.min(MAX_PANES, layout.panes.length))) {
      await this.unsplit();
    }
    while (this.panes.length < Math.min(MAX_PANES, layout.panes.length)) this.split();

    for (let i = 0; i < this.panes.length; i++) {
      const saved = layout.panes[i];
      if (saved) await this.panes[i]!.restore(saved.tabs, saved.active);
    }
    this.setActive(Math.min(layout.activePane, this.panes.length - 1));
  }

  destroy(): void {
    for (const pane of this.panes) pane.destroy();
    this.panes.length = 0;
  }

  private other(): DocumentPane {
    return this.panes[(this.activeIndex + 1) % this.panes.length]!;
  }

  private make(): DocumentPane {
    const pane = this.opts.createPane(
      () => this.setActive(this.panes.indexOf(pane)),
      () => this.opts.onChanged(),
    );
    return pane;
  }

  private setActive(index: number): void {
    if (index < 0 || index >= this.panes.length || index === this.activeIndex) return;
    this.activeIndex = index;
    this.syncActive();
    this.opts.onChanged();
  }

  private syncActive(): void {
    this.panes.forEach((pane, i) => pane.setActive(this.isSplit && i === this.activeIndex));
  }
}
