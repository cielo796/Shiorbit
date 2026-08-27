import type { VPath } from '../core/vault/types';
import { DocumentArea, type DocumentAreaOptions } from './documentArea';
import { TabStrip } from './tabStrip';
import { el } from './dom';

export interface DocumentPaneOptions extends DocumentAreaOptions {
  /** タブの並びや選択が変わった。App が状態を保存し直す。 */
  onTabsChanged: () => void;
  /** このペインが操作された。分割時にどちらが「いま」かを決める。 */
  onFocus: () => void;
}

/**
 * タブを1列持つドキュメント領域（設計書 §8）。
 *
 * 開いた文書の順番はここが持ち、中身の出し入れは DocumentArea に任せる。
 * 分割するときは、これをペインの数だけ作る。
 */
export class DocumentPane {
  readonly dom: HTMLElement;
  readonly area: DocumentArea;
  private readonly strip: TabStrip;
  private tabs: VPath[] = [];

  constructor(private readonly opts: DocumentPaneOptions) {
    this.area = new DocumentArea(opts);
    this.strip = new TabStrip({
      onSelect: (path) => void this.open(path),
      onClose: (path) => void this.close(path),
    });

    this.dom = el('div', 'document-pane');
    this.dom.append(this.strip.dom, this.area.dom);
    this.dom.addEventListener('pointerdown', () => this.opts.onFocus(), true);
    this.dom.addEventListener('focusin', () => this.opts.onFocus());
  }

  get path(): VPath | null {
    return this.area.path;
  }

  get openPaths(): readonly VPath[] {
    return this.tabs;
  }

  has(path: VPath): boolean {
    return this.tabs.includes(path);
  }

  async open(path: VPath, offset?: number): Promise<boolean> {
    const opened = await this.area.open(path, offset);
    if (!opened) return false;

    if (!this.tabs.includes(path)) this.tabs.push(path);
    this.refreshTabs();
    this.opts.onTabsChanged();
    return true;
  }

  /** タブを閉じる。最後の1枚を閉じたら空の状態に戻る。 */
  async close(path?: VPath): Promise<void> {
    const target = path ?? this.area.path;
    if (target === null) return;

    const at = this.tabs.indexOf(target);
    if (at < 0) return;
    if (this.area.path === target) await this.area.saveNow();

    this.tabs.splice(at, 1);
    this.area.forget(target);

    if (this.area.path === null && this.tabs.length > 0) {
      // 閉じた場所のとなりへ移る。右が無ければ左。
      const next = this.tabs[Math.min(at, this.tabs.length - 1)]!;
      await this.area.open(next);
    }
    this.refreshTabs();
    this.opts.onTabsChanged();
  }

  /** 次 / 前のタブへ。Ctrl+Tab 用。 */
  async cycle(step: number): Promise<void> {
    if (this.tabs.length < 2) return;
    const at = this.area.path === null ? -1 : this.tabs.indexOf(this.area.path);
    const next = (at + step + this.tabs.length) % this.tabs.length;
    await this.open(this.tabs[next]!);
  }

  /** 削除された文書などをタブからも外す。 */
  forget(path: VPath): void {
    const at = this.tabs.indexOf(path);
    if (at >= 0) this.tabs.splice(at, 1);
    this.area.forget(path);
    this.refreshTabs();
    this.opts.onTabsChanged();
  }

  /** 開き直し（保存状態の見た目だけ更新する）。 */
  refreshTabs(): void {
    this.strip.setTabs(
      this.tabs.map((path) => ({ path, dirty: path === this.area.path && this.area.isDirty })),
      this.area.path,
    );
  }

  setActive(active: boolean): void {
    this.dom.classList.toggle('active-pane', active);
  }

  /** 復元用。開いていたタブと選択を丸ごと入れ替える。 */
  async restore(paths: readonly VPath[], active: VPath | null): Promise<void> {
    this.tabs = [];
    for (const path of paths) {
      if (!this.tabs.includes(path)) this.tabs.push(path);
    }

    const target = active !== null && this.tabs.includes(active) ? active : this.tabs[0];
    if (target !== undefined && !(await this.area.open(target))) {
      // 開けなかったものはタブにも残さない。
      this.tabs = this.tabs.filter((path) => path !== target);
    }
    this.refreshTabs();
  }

  destroy(): void {
    this.area.destroy();
    this.tabs = [];
  }
}
