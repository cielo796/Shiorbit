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
  constructor(private readonly opts: VaultSyncOptions) {}

  async handle(ev: VaultEvent): Promise<void> {
    if (ev.type === 'error') {
      if (isVaultError(ev.error, 'EPERM')) {
        this.opts.toast('フォルダへのアクセス権が切れました。開き直してください。', true);
      }
      return;
    }
    if (ev.type === 'refresh') return;

    if (ev.type === 'modify') {
      await this.opts.applyExternal(ev.path);
      await this.reindex(ev.path);
      return;
    }
    if (ev.type === 'create') {
      await this.opts.refreshTree();
      await this.reindex(ev.path);
      return;
    }
    if (ev.type === 'delete') {
      if (isSupportedDocument(ev.path)) this.opts.index()?.removeNote(ev.path);
      await this.opts.refreshTree();
      return;
    }

    this.opts.index()?.removeNote(ev.from);
    await this.reindex(ev.to);
    await this.opts.refreshTree();
  }

  /** 索引に載るのは Markdown / HTML だけ。 */
  private async reindex(path: VPath): Promise<void> {
    if (isSupportedDocument(path)) await this.opts.index()?.updateNote(path);
  }
}
