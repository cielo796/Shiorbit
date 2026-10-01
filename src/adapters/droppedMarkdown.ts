import type { IncomingMarkdown } from '../core/notes/MarkdownImporter';

/** ドロップイベント中に読み込み元を確保する。元ファイルの書き換え・削除は行わない。 */
export async function captureDroppedMarkdown(transfer: DataTransfer): Promise<IncomingMarkdown[]> {
  const items = Array.from(transfer.items ?? []).filter((item) => item.kind === 'file');
  if (items.length > 0) {
    return items.flatMap((item): IncomingMarkdown[] => {
      const entry = item.webkitGetAsEntry?.();
      if (entry?.isDirectory) {
        return [{ name: entry.name, kind: 'directory', readText: async () => { throw new Error('フォルダは読めません。'); } }];
      }
      const file = item.getAsFile();
      return file ? [source(file)] : [];
    });
  }
  return Array.from(transfer.files).map(source);
}

function source(file: File): IncomingMarkdown {
  return {
    name: file.name,
    kind: 'file',
    readText: async () => {
      const data = await file.arrayBuffer();
      try {
        // 不正な文字を置換して保存しない。UTF-8 の BOM と改行もそのまま残す。
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data);
        if (text.includes('\0')) throw new Error('binary');
        return text;
      } catch {
        throw new Error('UTF-8 の文書として読めません。元ファイルは変更していません。');
      }
    },
  };
}
