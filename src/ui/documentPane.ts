import type { VPath } from '../core/vault/types';
import { DocumentArea, type DocumentAreaOptions } from './documentArea';
import { TabStrip } from './tabStrip';
import { openContextMenu } from './contextMenu';
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
      onMenu: (path, x, y) => this.openTabMenu(path, x, y),
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

  /**
   * 基準のタブから見て、片側のタブをまとめて閉じる。
   * `both` は「他のタブを閉じる」。基準そのものは残す。
   */
  async closeSide(base: VPath, side: 'left' | 'right' | 'both'): Promise<void> {
    const at = this.tabs.indexOf(base);
    if (at < 0) return;

    const targets = this.tabs.filter((path, i) => {
      if (path === base) return false;
      if (side === 'left') return i < at;
      if (side === 'right') return i > at;
      return true;
    });
    if (targets.length === 0) return;

    // 基準を先に出しておく。閉じる途中で別のタブへ移り、
    // その保存や読み込みが挟まるのを避ける。
    if (this.area.path !== base) await this.open(base);
    for (const path of targets) {
      this.tabs.splice(this.tabs.indexOf(path), 1);
      this.area.forget(path);
    }

    this.refreshTabs();
    this.opts.onTabsChanged();
  }

  /** 片側にタブがあるか。メニューの出し分けに使う。 */
  countSide(base: VPath, side: 'left' | 'right' | 'both'): number {
    const at = this.tabs.indexOf(base);
    if (at < 0) return 0;
    if (side === 'left') return at;
    if (side === 'right') return this.tabs.length - at - 1;
    return this.tabs.length - 1;
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

  /** タブの右クリックメニュー。片側だけ閉じる導線をここに集める。 */
  private openTabMenu(path: VPath, x: number, y: number): void {
    openContextMenu(x, y, [
      { label: 'このタブを閉じる', run: () => void this.close(path) },
      {
        label: `左側のタブを閉じる（${this.countSide(path, 'left')}）`,
        enabled: this.countSide(path, 'left') > 0,
        run: () => void this.closeSide(path, 'left'),
      },
      {
        label: `右側のタブを閉じる（${this.countSide(path, 'right')}）`,
        enabled: this.countSide(path, 'right') > 0,
        run: () => void this.closeSide(path, 'right'),
      },
      {
        label: `他のタブを閉じる（${this.countSide(path, 'both')}）`,
        enabled: this.countSide(path, 'both') > 0,
        run: () => void this.closeSide(path, 'both'),
      },
    ]);
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
