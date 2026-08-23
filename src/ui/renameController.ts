import type { Indexer } from '../core/index/Indexer';
import { applyRenamePlan, planRename } from '../core/refactor/planRename';
import { dirname, extname, isSupportedDocument, join, normalize } from '../core/vault/path';
import type { VaultService } from '../core/vault/VaultService';
import type { VPath } from '../core/vault/types';
import { confirmRename } from './renameDialog';

export interface RenameControllerOptions {
  vault: () => VaultService | null;
  index: () => Indexer | null;
  currentPath: () => VPath | null;
  ensureSaved: () => Promise<boolean>;
  refreshTree: () => Promise<void>;
  openNote: (path: VPath) => Promise<void>;
  notify: (message: string, isError?: boolean) => void;
}

/** 改名の入力・影響確認・書き換え・再インデックスを一つの手順として管理する。 */
export class RenameController {
  constructor(private readonly opts: RenameControllerOptions) {}

  async rename(from: VPath): Promise<void> {
    const vault = this.opts.vault();
    const index = this.opts.index();
    if (!vault || !index || !isSupportedDocument(from)) return;
    if (!await this.opts.ensureSaved()) {
      this.opts.notify('未保存の変更があるため、名前を変更できません。', true);
      return;
    }

    const input = window.prompt('新しいノート名（フォルダ付きも可）', from);
    if (input === null) return;
    const trimmed = input.trim();
    if (trimmed === '') return;
    const withFolder = trimmed.includes('/') ? trimmed : join(dirname(from), trimmed);
    const to = normalize(extname(withFolder) === '' ? `${withFolder}${extname(from)}` : withFolder);
    if (to === from) return;
    if (!isSupportedDocument(to)) {
      this.opts.notify('変更後のファイル形式は .md / .html / .htm にしてください。', true);
      return;
    }

    try {
      if (await vault.exists(to)) {
        this.opts.notify(`${to} は既に存在します。`, true);
        return;
      }
      const plan = await planRename(vault, index, from, to);
      if (!await confirmRename(plan)) return;

      const activePath = this.opts.currentPath();
      await applyRenamePlan(vault, plan);
      index.removeNote(from);
      await index.updateNote(to);
      for (const file of plan.files) {
        const updatedPath = file.path === from ? to : file.path;
        if (updatedPath !== to) await index.updateNote(updatedPath);
      }
      await this.opts.refreshTree();

      if (activePath === from) await this.opts.openNote(to);
      else if (activePath && plan.files.some((file) => file.path === activePath)) {
        await this.opts.openNote(activePath);
      }
      this.opts.notify(
        `${from} を ${to} に変更しました。` +
        (plan.occurrenceCount > 0 ? ` リンク ${plan.occurrenceCount} か所を更新しました。` : ''),
      );
    } catch (error) {
      this.opts.notify(error instanceof Error ? error.message : String(error), true);
    }
  }
}
