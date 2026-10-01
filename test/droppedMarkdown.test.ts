import { describe, expect, it, vi } from 'vitest';
import { captureDroppedMarkdown } from '../src/adapters/droppedMarkdown';

function file(name: string, data: Uint8Array): File {
  return { name, arrayBuffer: vi.fn(async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)) } as unknown as File;
}
function transfer(files: File[]): DataTransfer {
  return { files, items: [] } as unknown as DataTransfer;
}

describe('ドロップしたファイルの読み込み', () => {
  it('イベント内でファイルを確保し、後でUTF-8のBOM・改行を保って読める', async () => {
    const data = new TextEncoder().encode('\ufeff# 日本語\r\n本文\n');
    const original = file('メモ.md', data);
    const files = [original];
    const pending = captureDroppedMarkdown(transfer(files));
    files.length = 0;
    const captured = await pending;
    expect(captured[0]?.name).toBe('メモ.md');
    expect(original.arrayBuffer).not.toHaveBeenCalled();
    const text = await captured[0]!.readText();
    expect(new TextEncoder().encode(text)).toEqual(data);
  });

  it.each([new Uint8Array([0x82, 0xa0]), new Uint8Array([0])])('不正なUTF-8やバイナリを文字化けさせて返さない', async (data) => {
    const [captured] = await captureDroppedMarkdown(transfer([file('broken.md', data)]));
    await expect(captured!.readText()).rejects.toThrow('UTF-8');
  });

  it('空のMarkdownとOSからの読み込み失敗を区別する', async () => {
    const empty = file('empty.md', new Uint8Array());
    const bad = { name: 'bad.md', arrayBuffer: async () => { throw new Error('EIO'); } } as unknown as File;
    const captured = await captureDroppedMarkdown(transfer([empty, bad]));
    expect(await captured[0]!.readText()).toBe('');
    await expect(captured[1]!.readText()).rejects.toThrow('EIO');
  });

  it('ドロップ項目からフォルダを判別し、文字列項目は読み込まない', async () => {
    const actual = file('note.md', new TextEncoder().encode('# A'));
    const captured = await captureDroppedMarkdown({
      files: [],
      items: [
        { kind: 'string', getAsFile: () => { throw new Error('文字列'); } },
        { kind: 'file', webkitGetAsEntry: () => ({ name: 'folder.md', isDirectory: true }) },
        { kind: 'file', getAsFile: () => actual },
      ],
    } as unknown as DataTransfer);
    expect(captured.map(({ name, kind }) => ({ name, kind }))).toEqual([
      { name: 'folder.md', kind: 'directory' }, { name: 'note.md', kind: 'file' },
    ]);
  });
});
