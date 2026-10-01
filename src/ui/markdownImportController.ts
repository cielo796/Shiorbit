import type { Indexer } from '../core/index/Indexer';
import {
  MarkdownImporter, type ImportConflict, type IncomingMarkdown, type ImportResult,
} from '../core/notes/MarkdownImporter';
import type { VaultService } from '../core/vault/VaultService';
import type { VPath } from '../core/vault/types';
import { confirmDialog, openDialog } from './dialog';
import { button, el } from './dom';

export type CaptureDroppedMarkdown = (transfer: DataTransfer) => Promise<IncomingMarkdown[]>;

export interface MarkdownImportOptions {
  vault: () => VaultService | null;
  index: () => Indexer | null;
  capture: CaptureDroppedMarkdown;
  refreshTree: () => Promise<void>;
  reveal: (path: VPath) => void;
  /** 貼り付けで保存できたファイルだけを開く。ドロップでは呼ばない。 */
  openImported?: (path: VPath) => Promise<void>;
  toast: (message: string, isError?: boolean) => void;
}

/** ドロップは一覧更新のみ。貼り付けでは保存したファイルを開く。 */
export class MarkdownImportController {
  private readonly importers = new WeakMap<VaultService, MarkdownImporter>();
  constructor(private readonly opts: MarkdownImportOptions) {}

  async drop(dir: VPath, transfer: DataTransfer): Promise<void> {
    await this.importTransfer(dir, transfer);
  }

  /** Explorer などでコピーしたファイルを、ドロップと同じ規則で取り込む。 */
  async paste(dir: VPath, transfer: DataTransfer): Promise<void> {
    await this.importTransfer(dir, transfer, true);
  }

  private async importTransfer(dir: VPath, transfer: DataTransfer, openImported = false): Promise<void> {
    const vault = this.opts.vault();
    if (!vault) return;
    const index = this.opts.index();
    try {
      // DataTransfer の中身は drop の同期処理中に確保する必要がある。
      const files = await this.opts.capture(transfer);
      if (files.length === 0) { this.opts.toast('取り込めるファイルがありません。', true); return; }
      let importer = this.importers.get(vault);
      if (!importer) { importer = new MarkdownImporter(vault); this.importers.set(vault, importer); }
      const result = await importer.import(
        dir,
        files,
        () => this.opts.vault() !== vault,
        (conflicts) => this.confirmOverwrite(conflicts),
      );
      if (this.opts.vault() !== vault) return;
      // 保存と表示更新の失敗は区別する。保存済みを「取り込み失敗」と案内しない。
      try {
        for (const path of result.imported) {
          if (this.opts.vault() !== vault) return;
          await index?.updateNote(path);
        }
        if (this.opts.vault() !== vault) return;
        await this.opts.refreshTree();
        if (this.opts.vault() !== vault) return;
        if (result.imported[0]) this.opts.reveal(result.imported[0]);
      } catch {
        this.opts.toast('ファイルは保存しましたが、一覧の更新に失敗しました。再読み込みしてください。', true);
      }
      if (openImported && this.opts.openImported) {
        try {
          for (const path of result.imported) {
            if (this.opts.vault() !== vault) return;
            await this.opts.openImported(path);
          }
        } catch {
          this.opts.toast('ファイルは保存しましたが、開けませんでした。一覧から開き直してください。', true);
        }
      }
      if (this.opts.vault() === vault) this.report(result, dir || vault.name);
    } catch (error) {
      this.opts.toast(`取り込めませんでした: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  }

  private report(result: ImportResult, destination: string): void {
    const summary = `${destination}: ${result.imported.length}件取り込み、${result.skipped.length}件スキップ、${result.failed.length}件失敗`;
    if (result.skipped.length === 0 && result.failed.length === 0) { this.opts.toast(summary); return; }
    const frame = openDialog('ファイルの取り込み結果', 'dialog import-result-dialog', () => frame.close());
    frame.body.append(el('p', undefined, summary), el('p', undefined, '元ファイルは変更していません。'));
    const list = el('ul', 'import-issues');
    for (const issue of [...result.skipped, ...result.failed]) list.append(el('li', undefined, `${issue.name}: ${issue.reason}`));
    frame.body.append(list);
    const close = button('閉じる', 'primary', () => frame.close());
    frame.footer.append(close);
    close.focus();
  }

  private confirmOverwrite(conflicts: readonly ImportConflict[]): Promise<boolean> {
    const shown = conflicts.slice(0, 10).map((conflict) => `・${conflict.path}`);
    if (conflicts.length > shown.length) shown.push(`・ほか ${conflicts.length - shown.length} 件`);
    return confirmDialog({
      title: '同名ファイルの確認',
      message: [
        `保存先に同名ファイルが ${conflicts.length} 件あります。`,
        ...shown,
        '上書きすると、現在の内容は失われます。',
      ].join('\n'),
      confirmLabel: '上書きする',
      cancelLabel: '上書きしない',
      danger: true,
      preferCancel: true,
    });
  }
}
