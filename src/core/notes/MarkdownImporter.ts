import { dirname, isHidden, isHtml, isMarkdown, join, normalize } from '../vault/path';
import type { VaultService } from '../vault/VaultService';
import type { VPath } from '../vault/types';

/** 読み込み元の実体はアダプタ内に留め、名前と非同期の読み込みだけを渡す。 */
export interface IncomingMarkdown {
  name: string;
  kind: 'file' | 'directory';
  readText: () => Promise<string>;
}

export interface ImportIssue { name: string; reason: string }
export interface ImportConflict { name: string; path: VPath }
export interface ImportResult {
  imported: VPath[];
  skipped: ImportIssue[];
  failed: ImportIssue[];
}

/** 同じ Vault への連続ドロップを直列化し、確認なしの上書きを防ぐ。 */
export class MarkdownImporter {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly vault: VaultService) {}

  import(
    dir: VPath,
    files: readonly IncomingMarkdown[],
    cancelled = (): boolean => false,
    confirmOverwrite = async (_conflicts: readonly ImportConflict[]): Promise<boolean> => false,
  ): Promise<ImportResult> {
    const run = this.queue.then(() => this.run(dir, files, cancelled, confirmOverwrite));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async run(
    dir: VPath,
    files: readonly IncomingMarkdown[],
    cancelled: () => boolean,
    confirmOverwrite: (conflicts: readonly ImportConflict[]) => Promise<boolean>,
  ): Promise<ImportResult> {
    const result: ImportResult = { imported: [], skipped: [], failed: [] };
    if (normalize(dir) !== dir || isHidden(dir)) throw new Error('取り込み先が不正です。');
    const entries = await this.vault.listAll();
    if (dir !== '' && !entries.some((entry) => entry.kind === 'dir' && entry.path === dir)) {
      throw new Error('取り込み先フォルダが見つかりません。');
    }
    // 大文字小文字だけが異なる名前も衝突とする（端末間の同期でも安全に扱う）。
    const taken = new Map(entries
      .filter((entry) => dirname(entry.path) === dir)
      .map((entry) => [entry.name.toLowerCase(), entry] as const));
    const batchNames = new Set<string>();
    const candidates: Array<{ file: IncomingMarkdown; path: VPath; overwrite: boolean }> = [];

    for (const file of files) {
      const reason = invalidImportReason(file);
      if (reason) { result.skipped.push({ name: file.name, reason }); continue; }
      const key = file.name.toLowerCase();
      if (batchNames.has(key)) {
        result.skipped.push({ name: file.name, reason: '同じ名前のファイルが複数ドロップされたため、最初の1件だけを処理します。' });
        continue;
      }
      batchNames.add(key);
      const existing = taken.get(key);
      if (existing?.kind === 'dir') {
        result.skipped.push({ name: file.name, reason: '同名のフォルダがあるため保存できません。' });
        continue;
      }
      candidates.push({ file, path: existing?.path ?? join(dir, file.name), overwrite: existing?.kind === 'file' });
    }

    const conflicts = candidates
      .filter((candidate) => candidate.overwrite)
      .map(({ file, path }) => ({ name: file.name, path }));
    const overwriteConfirmed = conflicts.length > 0 && !cancelled()
      ? await confirmOverwrite(conflicts)
      : false;

    for (const candidate of candidates) {
      const { file } = candidate;
      if (cancelled()) {
        result.skipped.push({ name: file.name, reason: '保存先の設定が変わったため取り消しました。' });
        continue;
      }
      let { path, overwrite } = candidate;
      if (overwrite && !overwriteConfirmed) {
        result.skipped.push({ name: file.name, reason: '同名ファイルの上書きをキャンセルしました。' });
        continue;
      }
      try {
        // 一覧取得後に同名ファイルが作られた場合も、黙って上書きしない。
        if (!overwrite && await this.vault.exists(path)) {
          overwrite = await confirmOverwrite([{ name: file.name, path }]);
          if (!overwrite) {
            result.skipped.push({ name: file.name, reason: '同名ファイルの上書きをキャンセルしました。' });
            continue;
          }
        }
        const text = await file.readText();
        if (cancelled()) {
          result.skipped.push({ name: file.name, reason: '保存先の設定が変わったため取り消しました。' });
          continue;
        }
        if (overwrite) await this.vault.overwriteNote(path, text);
        else await this.vault.createNote(path, text);
        result.imported.push(path);
      } catch (error) {
        result.failed.push({ name: file.name, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    return result;
  }
}

function invalidImportReason(file: IncomingMarkdown): string | null {
  if (file.kind !== 'file') return 'フォルダごとの取り込みには対応していません。';
  if (!isMarkdown(file.name) && !isHtml(file.name)) return '.md / .html / .htm ファイルだけ取り込めます。';
  if (file.name.startsWith('.') || /[\/\\:*?"<>|\u0000-\u001f]/.test(file.name) ||
      /[. ]$/.test(file.name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(file.name)) {
    return '保存できないファイル名です。名前を変更してから取り込んでください。';
  }
  return null;
}
