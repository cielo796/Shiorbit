import type { Indexer } from '../core/index/Indexer';
import { applyRenamePlan, planRename } from '../core/refactor/planRename';
import { basename, dirname, extname, isOpenable, isSupportedDocument, join } from '../core/vault/path';
import type { VaultService } from '../core/vault/VaultService';
import type { VPath } from '../core/vault/types';
import { promptDialog } from './dialog';
import { invalidNameReason } from '../core/notes/newDocument';

export interface RenameControllerOptions {
  vault: () => VaultService | null;
  index: () => Indexer | null;
  currentPath: () => VPath | null;
  ensureSaved: () => Promise<boolean>;
  refreshTree: () => Promise<void>;
  openNote: (path: VPath) => Promise<void>;
  notify: (message: string, isError?: boolean) => void;
}

/** 改名の入力・リンク書き換え・再インデックスを一つの手順として管理する。 */
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

    const input = await promptDialog({
      title: 'ノート名を変更',
      label: '新しい名前',
      hint: '現在のフォルダ内で名前だけ変更します。拡張子を省くと元のままです。',
      value: basename(from),
      confirmLabel: '変更',
      validate: invalidRenameNameReason,
    });
    if (input === null) return;
    const trimmed = input.trim();
    if (trimmed === '') return;
    const leaf = extname(trimmed) === '' ? `${trimmed}${extname(from)}` : trimmed;
    const to = join(dirname(from), leaf);
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
      await this.applyDocumentPlan(vault, index, plan);
      this.opts.notify(
        `${from} を ${to} に変更しました。` +
        (plan.occurrenceCount > 0 ? ` リンク ${plan.occurrenceCount} か所を更新しました。` : ''),
      );
    } catch (error) {
      this.opts.notify(error instanceof Error ? error.message : String(error), true);
    }
  }

  /** ツリー内 D&D から、ファイル名を保ったまま指定フォルダへ移す。 */
  async move(from: VPath, dir: VPath): Promise<void> {
    const vault = this.opts.vault();
    if (!vault || !isOpenable(from)) return;
    const to = join(dir, basename(from));
    if (to === from) return;
    if (!await this.opts.ensureSaved()) {
      this.opts.notify('未保存の変更があるため、ファイルを移動できません。', true);
      return;
    }

    try {
      if (await vault.exists(to)) {
        this.opts.notify(`${to} は既に存在するため移動できません。`, true);
        return;
      }

      let occurrenceCount = 0;
      if (isSupportedDocument(from)) {
        const index = this.opts.index();
        if (!index) {
          this.opts.notify('索引を読み込めないため、ファイルを移動できません。', true);
          return;
        }
        const plan = await planRename(vault, index, from, to);
        occurrenceCount = plan.occurrenceCount;
        await this.applyDocumentPlan(vault, index, plan);
      } else {
        const activePath = this.opts.currentPath();
        await vault.rename(from, to);
        await this.opts.refreshTree();
        if (activePath === from) await this.opts.openNote(to);
      }

      this.opts.notify(
        `${from} を ${to} に移動しました。` +
        (occurrenceCount > 0 ? ` リンク ${occurrenceCount} か所を更新しました。` : ''),
      );
    } catch (error) {
      this.opts.notify(error instanceof Error ? error.message : String(error), true);
    }
  }

  private async applyDocumentPlan(vault: VaultService, index: Indexer, plan: Awaited<ReturnType<typeof planRename>>): Promise<void> {
    const activePath = this.opts.currentPath();
    await applyRenamePlan(vault, plan);
    index.removeNote(plan.from);
    await index.updateNote(plan.to);
    for (const file of plan.files) {
      const updatedPath = file.path === plan.from ? plan.to : file.path;
      if (updatedPath !== plan.to) await index.updateNote(updatedPath);
    }
    await this.opts.refreshTree();

    if (activePath === plan.from) await this.opts.openNote(plan.to);
    else if (activePath && plan.files.some((file) => file.path === activePath)) {
      await this.opts.openNote(activePath);
    }
  }
}

/** 改名ではパス区切りを受け付けず、現在のフォルダを固定する。 */
export function invalidRenameNameReason(name: string): string | null {
  if (/[\\/]/.test(name)) return 'フォルダは変更できません。ファイル名だけ入力してください。';
  return invalidNameReason(name);
}
