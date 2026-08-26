import { extname, isHtml, isMarkdown, isSupportedDocument, join, normalize } from '../vault/path';
import type { VPath } from '../vault/types';

/** 新規作成で選べる種別。folder だけはファイルではなくディレクトリを作る。 */
export type NewDocumentKind = 'markdown' | 'html' | 'folder';

export interface NewDocumentPlan {
  path: VPath;
  /** 入力の拡張子から種別が確定した場合は、選択より拡張子を優先する。 */
  kind: NewDocumentKind;
}

/** Windows / macOS のどちらかで使えない文字。作成してから失敗するより先に弾く。 */
const INVALID_CHARS = /[\:*?"<>|]/;

/**
 * 入力欄の文字列を、実際に作るパスへ翻訳する。
 *
 * 入力は常に baseDir からの相対として扱う。
 * 「どこに作られるか」を作成前に一意に示せるようにするため、
 * 「/ を含むならルート相対」のような分岐は持たせない。
 */
export function resolveNewDocument(
  name: string,
  kind: NewDocumentKind,
  baseDir: VPath = '',
): NewDocumentPlan | null {
  const trimmed = name.trim();
  if (trimmed === '') return null;

  const path = join(baseDir, trimmed);
  if (path === '') return null;
  if (kind === 'folder') return { path, kind };
  if (isSupportedDocument(path)) return { path, kind: isHtml(path) ? 'html' : 'markdown' };

  return { path: `${path}${kind === 'html' ? '.html' : '.md'}`, kind };
}

/** 作成できない入力の理由。問題なければ null。 */
export function invalidNameReason(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return null;
  if (INVALID_CHARS.test(trimmed)) return '\ : * ? " < > | は名前に使えません。';
  if (normalize(trimmed) === '') return 'その名前では作成できません。';

  const ext = extname(trimmed);
  if (ext !== '' && !isMarkdown(trimmed) && !isHtml(trimmed)) {
    return '拡張子は .md / .html / .htm のいずれかにしてください。';
  }
  return null;
}

/** 新規ファイルの初期内容。開いた直後に書き始められる形にする。 */
export function newDocumentBody(kind: NewDocumentKind, title: string): string {
  if (kind !== 'html') return `# ${title}\n\n`;

  return [
    '<!doctype html>',
    '<html lang="ja">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `    <title>${escapeHtml(title)}</title>`,
    '  </head>',
    '  <body>',
    `    <h1>${escapeHtml(title)}</h1>`,
    '  </body>',
    '</html>',
    '',
  ].join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
