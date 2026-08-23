import type { Indexer } from '../index/Indexer';
import { parseLinks } from '../markdown/wikilink';
import type { VaultService } from '../vault/VaultService';
import type { VPath } from '../vault/types';
import { renameResolvedLinks, type LinkRewrite } from './renameLink';

export interface RenameFilePlan {
  path: VPath;
  originalText: string;
  updatedText: string;
  mtime: number;
  rewrites: Array<LinkRewrite & { line: number }>;
}

export interface RenamePlan {
  from: VPath;
  to: VPath;
  files: RenameFilePlan[];
  occurrenceCount: number;
}

/** Indexer の解決結果を再確認し、対象ノートに届くリンクだけを計画へ入れる。 */
export async function planRename(
  vault: VaultService,
  index: Indexer,
  from: VPath,
  to: VPath,
): Promise<RenamePlan> {
  const candidates = new Set(index.backlinks(from).map((backlink) => backlink.from));
  if (index.outgoing(from).some((out) => out.resolved === from)) candidates.add(from);

  const files: RenameFilePlan[] = [];
  for (const path of candidates) {
    const note = await vault.readNote(path);
    const refs = parseLinks(note.text).filter((ref) => index.resolve(ref.target, path) === from);
    const result = renameResolvedLinks(note.text, refs, to);
    if (result.rewrites.length === 0) continue;
    files.push({
      path,
      originalText: note.text,
      updatedText: result.text,
      mtime: note.mtime,
      rewrites: result.rewrites.map((rewrite) => ({
        ...rewrite,
        line: lineNumber(note.text, rewrite.from),
      })),
    });
  }

  files.sort((a, b) => a.path.localeCompare(b.path, 'ja'));
  return {
    from,
    to,
    files,
    occurrenceCount: files.reduce((sum, file) => sum + file.rewrites.length, 0),
  };
}

/** 参照元を書き換えてから改名し、改名に失敗した場合は書き換えを戻す。 */
export async function applyRenamePlan(vault: VaultService, plan: RenamePlan): Promise<void> {
  const written: RenameFilePlan[] = [];
  try {
    for (const file of plan.files) {
      await vault.writeNote(file.path, file.updatedText, file.mtime);
      written.push(file);
    }
    await vault.rename(plan.from, plan.to);
  } catch (error) {
    for (const file of written.reverse()) {
      try {
        await vault.overwriteNote(file.path, file.originalText);
      } catch {
        // 元の失敗を優先する。復元できなかった内容は呼び出し側でエラーとして通知される。
      }
    }
    throw error;
  }
}

function lineNumber(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}
