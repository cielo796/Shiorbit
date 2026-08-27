import type { Indexer } from '../core/index/Indexer';
import { isAncestor } from '../core/vault/path';
import type { TrashEntry } from '../core/vault/trash';
import type { VaultService } from '../core/vault/VaultService';
import type { VPath } from '../core/vault/types';
import type { CleanupPane } from './cleanupPane';
import { confirmDialog } from './dialog';

export interface CleanupControllerOptions {
  vault: () => VaultService | null;
  index: () => Indexer | null;
  pane: () => CleanupPane | null;
  refreshTree: () => Promise<void>;
  reindexAll: () => Promise<void>;
  /** 開いていた文書を忘れる（消えたものを開いたままにしない） */
  forget: (path: VPath) => void;
  toast: (message: string, isError?: boolean) => void;
}

/**
 * ごみ箱と競合ファイルの片付け。
 *
 * どちらも「消す前に一度退避する」方針なので、
 * 完全に消えるのは purge のときだけになるよう1か所へまとめる。
 */
export class CleanupController {
  constructor(private readonly opts: CleanupControllerOptions) {}

  async refresh(): Promise<void> {
    const vault = this.opts.vault();
    const pane = this.opts.pane();
    if (!vault || !pane) return;

    try {
      const [entries, conflicts] = await Promise.all([vault.listTrash(), vault.listConflicts()]);
      pane.setEntries(entries);
      pane.setConflicts(conflicts);
    } catch (e) {
      this.opts.toast(message(e), true);
    }
  }

  /** 削除はごみ箱への移動。実体は残るので、確認は軽く済ませる。 */
  async moveToTrash(path: VPath): Promise<void> {
    const vault = this.opts.vault();
    if (!vault) return;

    const ok = await confirmDialog({
      title: '削除',
      message: `「${path}」をごみ箱へ移します。\n\n「ごみ箱」タブから元に戻せます。`,
      confirmLabel: 'ごみ箱へ移す',
      danger: true,
    });
    if (!ok) return;

    try {
      await vault.moveToTrash(path);
      this.dropFromIndex(path);
      this.opts.forget(path);
      await this.opts.refreshTree();
      await this.refresh();
      this.opts.toast(`${path} をごみ箱へ移しました。「ごみ箱」タブから戻せます。`);
    } catch (e) {
      this.opts.toast(message(e), true);
    }
  }

  /**
   * 退避した競合ファイルを片付ける。
   * ここも完全削除ではなくごみ箱へ移す（見比べ終える前に消してしまわないように）。
   */
  async removeConflicts(paths?: readonly VPath[]): Promise<void> {
    const vault = this.opts.vault();
    if (!vault) return;

    const targets = paths ?? (await vault.listConflicts());
    if (targets.length === 0) return;

    const ok = await confirmDialog({
      title: '競合ファイルの片付け',
      message: targets.length === 1
        ? `「${targets[0]}」をごみ箱へ移します。`
        : `${targets.length} 件の競合ファイルをごみ箱へ移します。`,
      confirmLabel: 'ごみ箱へ移す',
      danger: true,
    });
    if (!ok) return;

    try {
      for (const path of targets) {
        await vault.moveToTrash(path);
        this.opts.index()?.removeNote(path);
        this.opts.forget(path);
      }
      await this.opts.refreshTree();
      await this.refresh();
      this.opts.toast(`${targets.length} 件をごみ箱へ移しました。`);
    } catch (e) {
      this.opts.toast(message(e), true);
    }
  }

  async restore(entry: TrashEntry): Promise<void> {
    const vault = this.opts.vault();
    if (!vault) return;

    try {
      const restored = await vault.restoreFromTrash(entry.path);
      await this.opts.refreshTree();
      await this.opts.reindexAll();
      await this.refresh();
      this.opts.toast(`${restored} を戻しました。`);
    } catch (e) {
      this.opts.toast(message(e), true);
    }
  }

  /** entry を省略するとごみ箱ごと空にする。ここだけが本当の削除。 */
  async purge(entry?: TrashEntry): Promise<void> {
    const vault = this.opts.vault();
    if (!vault) return;

    const ok = await confirmDialog({
      title: 'ごみ箱から完全に削除',
      message: entry
        ? `「${entry.original}」を完全に削除します。\n\nこの操作は取り消せません。`
        : 'ごみ箱の中身をすべて完全に削除します。\n\nこの操作は取り消せません。',
      confirmLabel: '完全に削除',
      danger: true,
    });
    if (!ok) return;

    try {
      await vault.purgeTrash(entry?.path);
      await this.refresh();
      this.opts.toast(entry ? `${entry.original} を完全に削除しました。` : 'ごみ箱を空にしました。');
    } catch (e) {
      this.opts.toast(message(e), true);
    }
  }

  /** フォルダを消したときは、中のノートもまとめて索引から外す。 */
  private dropFromIndex(root: VPath): void {
    const index = this.opts.index();
    if (!index) return;
    for (const path of index.paths()) {
      if (path === root || isAncestor(root, path)) index.removeNote(path);
    }
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
