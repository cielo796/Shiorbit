import type { Indexer } from '../core/index/Indexer';
import { isVaultError } from '../core/vault/errors';
import { isSupportedDocument } from '../core/vault/path';
import type { VaultEvent } from '../core/vault/VaultService';
import type { VPath } from '../core/vault/types';

export interface VaultSyncOptions {
  index: () => Indexer | null;
  refreshTree: () => Promise<void>;
  /** 開いている文書が外部で変わったときの取り込み */
  applyExternal: (path: VPath) => Promise<void>;
  toast: (message: string, isError?: boolean) => void;
}

/**
 * 外部で起きた変化を、ツリーと索引へ取り込む。
 *
 * どの種類のイベントで何を更新するかを1か所に集める。
 * 抜けると「ファイルはあるのにリンクが解決しない」状態が残るため。
 */
export class VaultSync {
  private pending: Array<{ event: VaultEvent; index: Indexer | null }> = [];
  private running: Promise<void> | null = null;
  constructor(private readonly opts: VaultSyncOptions) {}

  handle(event: VaultEvent): Promise<void> {
    this.pending.push({ event, index: this.opts.index() });
    // 同じポーリングで届くイベントをまとめる。処理中の次便も直列に流す。
    this.running ??= Promise.resolve().then(() => this.drain());
    return this.running;
  }

  private async drain(): Promise<void> {
    try {
      while (this.pending.length > 0) {
        const batch = this.pending.splice(0);
        const index = this.opts.index();
        const changes = new Map<VPath, 'update' | 'delete'>();
        const external = new Set<VPath>();
        let refresh = false;
        for (const item of batch) {
          if (item.index !== index) continue; // Vault切替前の通知を新しいVaultへ流さない。
          const ev = item.event;
          if (ev.type === 'error') {
            if (isVaultError(ev.error, 'EPERM')) this.opts.toast('フォルダへのアクセス権が切れました。開き直してください。', true);
          } else if (ev.type === 'modify') {
            changes.set(ev.path, 'update');
            external.add(ev.path);
          } else if (ev.type === 'create' || ev.type === 'delete') {
            changes.set(ev.path, ev.type === 'create' ? 'update' : 'delete');
            refresh = true;
          } else if (ev.type === 'rename') {
            changes.set(ev.from, 'delete');
            changes.set(ev.to, 'update');
            refresh = true;
          }
        }
        try {
          for (const path of external) {
            if (index !== this.opts.index()) break;
            if (changes.get(path) === 'update') await this.opts.applyExternal(path);
          }
          if (index !== this.opts.index()) continue;
          const updates: VPath[] = [], removed: VPath[] = [];
          for (const [path, action] of changes) {
            if (isSupportedDocument(path)) (action === 'update' ? updates : removed).push(path);
          }
          if (updates.length || removed.length) await index?.updateNotes(updates, removed);
          if (refresh && index === this.opts.index()) await this.opts.refreshTree();
        } catch {
          this.opts.toast('外部変更の反映に失敗しました。再インデックスで再試行できます。', true);
        }
      }
    } finally {
      this.running = null;
    }
  }
}
