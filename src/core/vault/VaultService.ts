import type { VaultAdapter } from './VaultAdapter';
import type { Entry, FileEvent, Unsubscribe, VPath } from './types';
import { ConflictError, isVaultError } from './errors';
import { isHidden, isMarkdown } from './path';

export interface NoteContent {
  path: VPath;
  text: string;
  /** 読み込んだ時点の mtime。保存時の競合検知に使う。 */
  mtime: number;
}

export type VaultEvent =
  | FileEvent
  | { type: 'refresh' }
  | { type: 'error'; error: unknown };

export interface VaultServiceOptions {
  /**
   * mtime 比較の許容誤差 (ms)。ファイルシステムごとの時刻解像度の差を吸収する。
   * テストでは 0 を指定して厳密に判定する。
   */
  mtimeToleranceMs?: number;
}

export interface WatchOptions {
  /** caps.watch が false のときのポーリング間隔 (ms) */
  intervalMs?: number;
}

/**
 * アプリ本体から見た Vault の窓口。
 *
 * このクラスは VaultAdapter しか知らない。
 * File System Access API も Capacitor も Node の fs も、ここには一切出てこない。
 */
export class VaultService {
  private readonly listeners = new Set<(ev: VaultEvent) => void>();
  private stopFn: Unsubscribe | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** ポーリング比較用スナップショット path -> mtime */
  private snapshot = new Map<VPath, number>();

  constructor(
    private readonly adapter: VaultAdapter,
    private readonly options: VaultServiceOptions = {},
  ) {}

  private get tolerance(): number {
    return this.options.mtimeToleranceMs ?? 1000;
  }

  get id(): string {
    return this.adapter.id;
  }

  get name(): string {
    return this.adapter.name;
  }

  get caps() {
    return this.adapter.caps;
  }

  // ---------------------------------------------------------------- events

  on(fn: (ev: VaultEvent) => void): Unsubscribe {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(ev: VaultEvent): void {
    for (const fn of [...this.listeners]) {
      try {
        fn(ev);
      } catch (error) {
        console.error('[VaultService] listener error', error);
      }
    }
  }

  // ------------------------------------------------------------------ read

  /** Vault 全体を列挙する。隠しフォルダ (.shiorbit など) は除外。 */
  async listAll(withStat = false): Promise<Entry[]> {
    const entries = await this.adapter.list('', true, withStat);
    return entries.filter((e) => !isHidden(e.path)).sort(compareEntries);
  }

  async listNotes(withStat = false): Promise<Entry[]> {
    const all = await this.listAll(withStat);
    return all.filter((e) => e.kind === 'file' && isMarkdown(e.path));
  }

  async readNote(path: VPath): Promise<NoteContent> {
    const [text, stat] = await Promise.all([
      this.adapter.read(path),
      this.adapter.stat(path),
    ]);
    return { path, text, mtime: stat.mtime };
  }

  async exists(path: VPath): Promise<boolean> {
    return this.adapter.exists(path);
  }

  // ----------------------------------------------------------------- write

  /**
   * ノートを保存する。
   *
   * baseMtime を渡すと、その時刻より新しいファイルが実在した場合に ConflictError を投げる。
   * 「外部で書き換わったものを黙って上書きしない」ための最小限の防波堤 (設計書 §9)。
   */
  async writeNote(path: VPath, text: string, baseMtime?: number): Promise<number> {
    if (baseMtime !== undefined) {
      const current = await this.safeStat(path);
      if (current && current.mtime > baseMtime + this.tolerance) {
        throw new ConflictError(path, baseMtime, current.mtime);
      }
    }

    await this.adapter.write(path, text);
    const after = await this.safeStat(path);
    const mtime = after?.mtime ?? Date.now();
    this.snapshot.set(path, mtime);
    return mtime;
  }

  /** 強制上書き。競合ダイアログで「自分を採用」を選んだときに使う。 */
  async overwriteNote(path: VPath, text: string): Promise<number> {
    return this.writeNote(path, text);
  }

  async createNote(path: VPath, text = ''): Promise<void> {
    if (await this.adapter.exists(path)) {
      throw new ConflictError(path, 0, Date.now());
    }
    await this.adapter.write(path, text);
    this.emit({ type: 'create', path });
  }

  async rename(from: VPath, to: VPath): Promise<void> {
    await this.adapter.rename(from, to);
    this.snapshot.delete(from);
    this.emit({ type: 'rename', from, to });
  }

  async remove(path: VPath): Promise<void> {
    await this.adapter.remove(path);
    this.snapshot.delete(path);
    this.emit({ type: 'delete', path });
  }

  async mkdir(path: VPath): Promise<void> {
    await this.adapter.mkdir(path);
    this.emit({ type: 'create', path });
  }

  /**
   * 競合したときの退避先を作る。
   * どちらを選んでも、失われる側は必ずファイルとして残す (設計書 §9)。
   */
  async saveConflictCopy(path: VPath, text: string): Promise<VPath> {
    const stamp = formatStamp(new Date());
    const dot = path.lastIndexOf('.');
    const target =
      dot > 0
        ? `${path.slice(0, dot)}.conflict-${stamp}${path.slice(dot)}`
        : `${path}.conflict-${stamp}`;
    await this.adapter.write(target, text);
    this.emit({ type: 'create', path: target });
    return target;
  }

  // --------------------------------------------------------------- watching

  /** 外部変更の監視を開始する。push 非対応のアダプタでは mtime ポーリングに落とす。 */
  startWatching(opts: WatchOptions = {}): void {
    this.stopWatching();

    if (this.adapter.watch) {
      this.stopFn = this.adapter.watch((ev) => this.emit(ev));
      return;
    }

    const interval = opts.intervalMs ?? 5000;
    void this.captureSnapshot();
    this.timer = setInterval(() => {
      void this.poll();
    }, interval);
  }

  stopWatching(): void {
    this.stopFn?.();
    this.stopFn = null;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** フォーカス復帰時などに明示的に1回だけ差分を取る */
  async poll(): Promise<FileEvent[]> {
    let entries: Entry[];
    try {
      entries = await this.listAll();
    } catch (error) {
      this.emit({ type: 'error', error });
      return [];
    }

    const next = new Map<VPath, number>();
    const events: FileEvent[] = [];

    for (const entry of entries) {
      if (entry.kind !== 'file') continue;
      const stat = await this.safeStat(entry.path);
      if (!stat) continue;
      next.set(entry.path, stat.mtime);

      const prev = this.snapshot.get(entry.path);
      if (prev === undefined) {
        events.push({ type: 'create', path: entry.path });
      } else if (prev !== stat.mtime) {
        events.push({ type: 'modify', path: entry.path });
      }
    }

    for (const path of this.snapshot.keys()) {
      if (!next.has(path)) events.push({ type: 'delete', path });
    }

    this.snapshot = next;
    for (const ev of events) this.emit(ev);
    return events;
  }

  private async captureSnapshot(): Promise<void> {
    this.snapshot.clear();
    try {
      for (const entry of await this.listAll()) {
        if (entry.kind !== 'file') continue;
        const stat = await this.safeStat(entry.path);
        if (stat) this.snapshot.set(entry.path, stat.mtime);
      }
    } catch (error) {
      this.emit({ type: 'error', error });
    }
  }

  private async safeStat(path: VPath) {
    try {
      return await this.adapter.stat(path);
    } catch (error) {
      if (isVaultError(error, 'ENOENT')) return null;
      throw error;
    }
  }

  dispose(): void {
    this.stopWatching();
    this.listeners.clear();
  }
}

/** ディレクトリを先に、次に名前順 (数字は自然順) */
function compareEntries(a: Entry, b: Entry): number {
  if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
  return a.path.localeCompare(b.path, 'ja', { numeric: true, sensitivity: 'base' });
}

function formatStamp(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
