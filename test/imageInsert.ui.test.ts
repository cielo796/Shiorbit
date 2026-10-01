// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../src/ui/app';
import { MemoryAdapter } from '../src/adapters/memory';

beforeAll(() => {
  Object.assign(Range.prototype, {
    getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    getClientRects: () => Object.assign([], { item: () => null }),
  });
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never;
});

afterEach(() => document.body.replaceChildren());
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function chosenImage(name: string, bytes: number[]): File {
  const data = new Uint8Array(bytes);
  return {
    name,
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  } as unknown as File;
}

async function setup(file: File) {
  const adapter = new MemoryAdapter('Image UI');
  await adapter.write('Notes/Current.md', '# 現在\n\n');
  const root = document.createElement('div');
  document.body.append(root);
  await new App(root, {
    supported: false, unsupportedReason: '', restore: async () => adapter,
    hasSaved: async () => true, pick: async () => adapter, demo: async () => adapter,
  }, { pickImageFile: async () => file }).start();
  root.querySelector<HTMLElement>('.row[data-path="Notes/Current.md"]')!.click();
  await settle();
  return { adapter, root };
}

function insertFromComputer(root: HTMLElement): void {
  root.querySelector<HTMLElement>('.cm-content')!.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: 12, clientY: 12,
  }));
  [...document.querySelectorAll<HTMLButtonElement>('.context-menu-item')]
    .find((button) => button.textContent === 'リンク・画像')!.click();
  [...document.querySelectorAll<HTMLButtonElement>('.context-menu-item')]
    .find((button) => button.textContent === 'PCから画像を追加…')!.click();
}

describe('右クリックからの画像追加', () => {
  it('ノート横のattachmentsへ画像をコピーし、相対埋め込みを本文へ挿入する', async () => {
    const { adapter, root } = await setup(chosenImage('photo.png', [1, 2, 3, 4]));
    insertFromComputer(root);
    await settle();

    expect([...new Uint8Array(await adapter.readBinary('Notes/attachments/photo.png'))]).toEqual([1, 2, 3, 4]);
    root.querySelector<HTMLElement>('.cm-content')!.dispatchEvent(new KeyboardEvent('keydown', {
      key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true,
    }));
    await settle();
    expect(await adapter.read('Notes/Current.md')).toContain('![[attachments/photo.png]]');
  });

  it('同名画像がある場合は上書きせず連番で保存する', async () => {
    const { adapter, root } = await setup(chosenImage('photo.png', [9]));
    await adapter.writeBinary('Notes/attachments/photo.png', new Uint8Array([1]).buffer);
    insertFromComputer(root);
    await settle();

    expect([...new Uint8Array(await adapter.readBinary('Notes/attachments/photo.png'))]).toEqual([1]);
    expect([...new Uint8Array(await adapter.readBinary('Notes/attachments/photo (2).png'))]).toEqual([9]);
  });
});
