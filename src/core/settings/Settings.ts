import type { Unsubscribe } from '../vault/types';
import type { VaultService } from '../vault/VaultService';
import { isVaultError } from '../vault/errors';

export interface SettingsData {
  theme: 'dark' | 'light';
  /** 記法を隠して見た目を整える (設計書 §7) */
  livePreview: boolean;
  showLineNumbers: boolean;
  /** 本文の #タグ をタグとして扱う。明示した frontmatter のタグは常に有効。 */
  autoCollectTags: boolean;
  /** 起動時に前回のタブ・分割を復元する。保存自体は常に行う。 */
  restoreTabsOnStartup: boolean;
  /** 起動時に前回のフォルダ開閉状態を復元する。OFFならすべて閉じる。 */
  restoreFoldersOnStartup: boolean;
  /** Daily Notes の置き場所と日付書式 */
  dailyFolder: string;
  dailyFormat: string;
  /** Daily Notes 作成時に読み込むテンプレート (空なら使わない) */
  dailyTemplate: string;
  templateFolder: string;
  /** 表示倍率。UI とエディタの文字サイズにまとめて掛かる */
  zoom: number;
  /** 基準の文字サイズ (px)。実際の表示は zoom を掛けた値になる */
  uiFontSize: number;
  editorFontSize: number;
  /** .html を開いたときの既定の表示 */
  htmlDefaultView: 'preview' | 'source';
  /** 入力が止まってから保存するまで (ms) */
  autoSaveDelay: number;
  /** 外部変更を見に行く間隔 (ms) */
  pollInterval: number;
}

export const LIMITS = {
  zoom: { min: 0.5, max: 2, step: 0.1 },
  uiFontSize: { min: 11, max: 22 },
  editorFontSize: { min: 11, max: 32 },
  autoSaveDelay: { min: 200, max: 10000 },
  pollInterval: { min: 1000, max: 120000 },
} as const;

export const DEFAULT_SETTINGS: SettingsData = {
  theme: 'dark',
  livePreview: true,
  showLineNumbers: true,
  autoCollectTags: true,
  restoreTabsOnStartup: true,
  restoreFoldersOnStartup: true,
  dailyFolder: 'Daily',
  dailyFormat: 'YYYY-MM-DD',
  dailyTemplate: '',
  templateFolder: 'Templates',
  zoom: 1,
  uiFontSize: 14,
  editorFontSize: 14.5,
  htmlDefaultView: 'preview',
  autoSaveDelay: 500,
  pollInterval: 5000,
};

export const SETTINGS_PATH = '.shiorbit/settings.json';
const SETTINGS_DIR = '.shiorbit';
const LEGACY_SETTINGS_PATH = '.obidisan/settings.json';

/**
 * 設定は Vault の中 (.shiorbit/settings.json) に置く。
 *
 * こうしておくと Vault と一緒に同期され、端末を変えても設定が付いてくる。
 * ブラウザのストレージを使わないので、境界を跨がずに済むという利点もある。
 */
export class Settings {
  private current: SettingsData = { ...DEFAULT_SETTINGS };
  /** 保存済みの値。preview 中でもここは動かさない。 */
  private saved: SettingsData = { ...DEFAULT_SETTINGS };
  private pendingUpdate: SettingsData | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(data: SettingsData) => void>();

  constructor(private readonly vault: VaultService) {}

  get data(): SettingsData {
    return this.current;
  }

  onChange(fn: (data: SettingsData) => void): Unsubscribe {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  async load(): Promise<void> {
    try {
      const raw = await this.vault.readNote(SETTINGS_PATH);
      this.current = normalize(JSON.parse(raw.text) as unknown);
      this.saved = this.current;
    } catch (e) {
      if (isVaultError(e, 'ENOENT')) {
        const migrated = await this.loadLegacy();
        if (migrated) {
          this.emit();
          return;
        }
      } else {
        // 壊れていても既定値に戻して続行する。
        console.warn('[Settings] 読み込みに失敗したため既定値を使います', e);
      }
      this.current = { ...DEFAULT_SETTINGS };
      this.saved = this.current;
    }
    this.emit();
  }

  /** preview 中でも保存済みの値を土台にする（試しただけの値を書き込まないため）。 */
  async update(patch: Partial<SettingsData>): Promise<void> {
    const next = normalize({ ...(this.pendingUpdate ?? this.saved), ...patch });
    this.pendingUpdate = next;
    this.current = next;
    this.emit();
    // スマホ等で保存が遅くても表示は即時更新し、連続操作の書き込み順を守る。
    const writing = this.writeQueue.then(() => this.save(next));
    this.writeQueue = writing.catch(() => undefined);
    try {
      await writing;
      this.saved = next;
    } catch (e) {
      if (this.current === next) {
        this.current = this.saved;
        this.emit();
      }
      throw e;
    } finally {
      if (this.pendingUpdate === next) this.pendingUpdate = null;
    }
  }

  /**
   * 保存せずに見た目だけ試す。
   * 設定画面で効果を確かめてから決められるようにするための一時適用で、
   * キャンセルすれば discardPreview() で保存済みの値へ戻る。
   */
  preview(patch: Partial<SettingsData>): void {
    this.current = normalize({ ...this.saved, ...patch });
    this.emit();
  }

  discardPreview(): void {
    if (this.current === this.saved) return;
    this.current = this.saved;
    this.emit();
  }

  async save(data: SettingsData = this.current): Promise<void> {
    try {
      await this.vault.mkdir(SETTINGS_DIR);
    } catch {
      /* すでにあれば無視 */
    }
    await this.vault.writeNote(SETTINGS_PATH, `${JSON.stringify(data, null, 2)}\n`);
  }

  /** 旧版の設定を読み、新しい保存先へコピーする。旧ファイルは安全のため残す。 */
  private async loadLegacy(): Promise<boolean> {
    try {
      const raw = await this.vault.readNote(LEGACY_SETTINGS_PATH);
      this.current = normalize(JSON.parse(raw.text) as unknown);
      this.saved = this.current;
      await this.save();
      return true;
    } catch (e) {
      if (!isVaultError(e, 'ENOENT')) {
        console.warn('[Settings] 旧 Obidisan 設定の移行に失敗しました', e);
      }
      return false;
    }
  }

  private emit(): void {
    for (const fn of [...this.listeners]) fn(this.current);
  }
}

/** 未知のキーや壊れた値を捨てて、既定値で埋める */
export function normalize(input: unknown): SettingsData {
  const src = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const str = (key: keyof SettingsData, fallback: string): string =>
    typeof src[key] === 'string' && src[key] !== '' ? (src[key] as string) : fallback;
  const num = (key: keyof typeof LIMITS): number => {
    const value = src[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SETTINGS[key];
    return clamp(value, LIMITS[key].min, LIMITS[key].max);
  };

  return {
    theme: src['theme'] === 'light' ? 'light' : 'dark',
    livePreview: typeof src['livePreview'] === 'boolean' ? src['livePreview'] : DEFAULT_SETTINGS.livePreview,
    showLineNumbers:
      typeof src['showLineNumbers'] === 'boolean' ? src['showLineNumbers'] : DEFAULT_SETTINGS.showLineNumbers,
    autoCollectTags:
      typeof src['autoCollectTags'] === 'boolean' ? src['autoCollectTags'] : DEFAULT_SETTINGS.autoCollectTags,
    restoreTabsOnStartup:
      typeof src['restoreTabsOnStartup'] === 'boolean' ? src['restoreTabsOnStartup'] : DEFAULT_SETTINGS.restoreTabsOnStartup,
    restoreFoldersOnStartup:
      typeof src['restoreFoldersOnStartup'] === 'boolean' ? src['restoreFoldersOnStartup'] : DEFAULT_SETTINGS.restoreFoldersOnStartup,
    dailyFolder: str('dailyFolder', DEFAULT_SETTINGS.dailyFolder),
    dailyFormat: str('dailyFormat', DEFAULT_SETTINGS.dailyFormat),
    dailyTemplate: typeof src['dailyTemplate'] === 'string' ? src['dailyTemplate'] : '',
    templateFolder: str('templateFolder', DEFAULT_SETTINGS.templateFolder),
    zoom: num('zoom'),
    uiFontSize: num('uiFontSize'),
    editorFontSize: num('editorFontSize'),
    htmlDefaultView: src['htmlDefaultView'] === 'source' ? 'source' : 'preview',
    autoSaveDelay: num('autoSaveDelay'),
    pollInterval: num('pollInterval'),
  };
}

/** 設定値は壊れていても既定値で続行する。範囲外は捨てずに端へ丸める。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
