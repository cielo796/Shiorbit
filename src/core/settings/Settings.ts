import type { Unsubscribe } from '../vault/types';
import type { VaultService } from '../vault/VaultService';
import { isVaultError } from '../vault/errors';

export interface SettingsData {
  theme: 'dark' | 'light';
  /** 記法を隠して見た目を整える (設計書 §7) */
  livePreview: boolean;
  showLineNumbers: boolean;
  /** Daily Notes の置き場所と日付書式 */
  dailyFolder: string;
  dailyFormat: string;
  /** Daily Notes 作成時に読み込むテンプレート (空なら使わない) */
  dailyTemplate: string;
  templateFolder: string;
}

export const DEFAULT_SETTINGS: SettingsData = {
  theme: 'dark',
  livePreview: true,
  showLineNumbers: true,
  dailyFolder: 'Daily',
  dailyFormat: 'YYYY-MM-DD',
  dailyTemplate: '',
  templateFolder: 'Templates',
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
    }
    this.emit();
  }

  async update(patch: Partial<SettingsData>): Promise<void> {
    this.current = normalize({ ...this.current, ...patch });
    this.emit();
    await this.save();
  }

  async save(): Promise<void> {
    try {
      await this.vault.mkdir(SETTINGS_DIR);
    } catch {
      /* すでにあれば無視 */
    }
    await this.vault.writeNote(SETTINGS_PATH, `${JSON.stringify(this.current, null, 2)}\n`);
  }

  /** 旧版の設定を読み、新しい保存先へコピーする。旧ファイルは安全のため残す。 */
  private async loadLegacy(): Promise<boolean> {
    try {
      const raw = await this.vault.readNote(LEGACY_SETTINGS_PATH);
      this.current = normalize(JSON.parse(raw.text) as unknown);
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

  return {
    theme: src['theme'] === 'light' ? 'light' : 'dark',
    livePreview: typeof src['livePreview'] === 'boolean' ? src['livePreview'] : DEFAULT_SETTINGS.livePreview,
    showLineNumbers:
      typeof src['showLineNumbers'] === 'boolean' ? src['showLineNumbers'] : DEFAULT_SETTINGS.showLineNumbers,
    dailyFolder: str('dailyFolder', DEFAULT_SETTINGS.dailyFolder),
    dailyFormat: str('dailyFormat', DEFAULT_SETTINGS.dailyFormat),
    dailyTemplate: typeof src['dailyTemplate'] === 'string' ? src['dailyTemplate'] : '',
    templateFolder: str('templateFolder', DEFAULT_SETTINGS.templateFolder),
  };
}
