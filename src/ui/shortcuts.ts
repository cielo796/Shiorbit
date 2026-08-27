import type { CommandRegistry } from '../core/commands/CommandRegistry';
import { LIMITS, clamp, type Settings } from '../core/settings/Settings';

export interface ShortcutOptions {
  /** Vault が開いていないときは何も受け付けない。 */
  active: () => boolean;
  settings: () => Settings | null;
  commands: CommandRegistry;
  openPalette: () => void;
  openQuickSwitcher: () => void;
  openGraph: () => void;
  toast: (message: string) => void;
}

/**
 * 画面全体のキーとホイール。
 *
 * ホットキーの割り当てはここに集め、実行はコマンドを通す
 * （パレットと同じ定義を指すようにして、動作のズレを防ぐ）。
 */
export class Shortcuts {
  constructor(private readonly opts: ShortcutOptions) {}

  /** window の keydown に繋ぐ。 */
  onKeyDown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || !this.opts.active()) return;
    const key = event.key.toLowerCase();

    // Ctrl+Tab はタブの巡回。Shift の有無で向きが変わる。
    if (event.key === 'Tab') {
      event.preventDefault();
      void this.opts.commands.run(event.shiftKey ? 'previous-tab' : 'next-tab');
      return;
    }

    if (event.shiftKey) {
      if (key === 'p') {
        event.preventDefault();
        this.opts.openPalette();
      } else if (key === 'f') {
        event.preventDefault();
        void this.opts.commands.run('search');
      } else if (key === 'd') {
        event.preventDefault();
        void this.opts.commands.run('daily-note');
      }
      return;
    }

    if (key === 'g') {
      event.preventDefault();
      this.opts.openGraph();
      return;
    }
    if (key === 'o' || key === 'p') {
      event.preventDefault();
      this.opts.openQuickSwitcher();
      return;
    }
    if (key === 'w') {
      event.preventDefault();
      void this.opts.commands.run('close-tab');
      return;
    }
    if (key === '\\') {
      event.preventDefault();
      void this.opts.commands.run('toggle-split');
      return;
    }

    // 拡大・縮小。ブラウザ自身のズームより先に受け取り、設定として保存する。
    // JIS 配列では Ctrl+; が Ctrl++ の位置にあるので、そちらも受ける。
    if (key === '=' || key === '+' || key === ';') {
      event.preventDefault();
      void this.zoomBy(LIMITS.zoom.step);
    } else if (key === '-' || key === '_') {
      event.preventDefault();
      void this.zoomBy(-LIMITS.zoom.step);
    } else if (key === '0') {
      event.preventDefault();
      void this.zoomBy(0);
    }
  }

  /** window の wheel に繋ぐ（passive: false で登録すること）。 */
  onWheel(event: WheelEvent): void {
    if (!(event.ctrlKey || event.metaKey) || this.opts.settings() === null) return;
    event.preventDefault();
    void this.zoomBy(event.deltaY < 0 ? LIMITS.zoom.step : -LIMITS.zoom.step);
  }

  /** delta が 0 なら等倍へ戻す。 */
  async zoomBy(delta: number): Promise<void> {
    const settings = this.opts.settings();
    if (!settings) return;

    const next = delta === 0 ? 1 : Math.round((settings.data.zoom + delta) * 100) / 100;
    const zoom = clamp(next, LIMITS.zoom.min, LIMITS.zoom.max);
    if (zoom === settings.data.zoom) return;

    await settings.update({ zoom });
    this.opts.toast(`表示倍率 ${Math.round(zoom * 100)}%`);
  }
}
