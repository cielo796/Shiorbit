import { describe, expect, it } from 'vitest';
import {
  forgetAndroidSafVault,
  hasAndroidSafVault,
  pickAndroidSafVault,
  restoreAndroidSafVault,
  type AndroidSafPlugin,
  type SafSelection,
} from '../src/adapters/androidSaf';
import { createFakeCapacitorFs } from './fakeCapacitorFs';

function createPlugin(initial: SafSelection | null = null): AndroidSafPlugin & { forgotten: boolean } {
  let saved = initial;
  const fs = createFakeCapacitorFs();
  return Object.assign(fs, {
    forgotten: false,
    async pickTree() {
      saved = { selected: true, uri: 'content://vault', name: 'Obdisan' };
      return saved;
    },
    async getSavedTree() {
      return saved ?? { selected: false };
    },
    async forgetTree() {
      saved = null;
      this.forgotten = true;
    },
  });
}

describe('Android SAF Vault', () => {
  it('選択したツリーを VaultAdapter として読み書きできる', async () => {
    const plugin = createPlugin();
    const vault = await pickAndroidSafVault(plugin);

    expect(vault.adapter.name).toBe('Obdisan');
    expect(vault.uri).toBe('content://vault');
    await vault.adapter.write('Memo/test.md', '# SAF');
    await expect(vault.adapter.read('Memo/test.md')).resolves.toBe('# SAF');
  });

  it('ネイティブの一括走査があれば1回で再帰列挙する', async () => {
    const plugin = createPlugin();
    const readdir = plugin.readdir;
    plugin.readdir = async () => {
      throw new Error('readdir should not be called');
    };
    plugin.scanTree = async () => ({
      files: [
        { path: 'Memo', name: 'Memo', type: 'directory', size: 0, mtime: 1 },
        { path: 'Memo/test.md', name: 'test.md', type: 'file', size: 5, mtime: 2 },
      ],
    });

    const vault = await pickAndroidSafVault(plugin);
    await expect(vault.adapter.list('', true, true)).resolves.toEqual([
      { path: 'Memo', name: 'Memo', kind: 'dir' },
      { path: 'Memo/test.md', name: 'test.md', kind: 'file', size: 5, mtime: 2 },
    ]);
    plugin.readdir = readdir;
  });

  it('永続化された選択を復元する', async () => {
    const plugin = createPlugin({ selected: true, uri: 'content://saved', name: 'Notes' });

    await expect(hasAndroidSafVault(plugin)).resolves.toBe(true);
    const restored = await restoreAndroidSafVault(plugin);
    expect(restored?.adapter.name).toBe('Notes');
    expect(restored?.uri).toBe('content://saved');
  });

  it('未選択なら復元しない', async () => {
    const plugin = createPlugin();

    await expect(hasAndroidSafVault(plugin)).resolves.toBe(false);
    await expect(restoreAndroidSafVault(plugin)).resolves.toBeNull();
  });

  it('システムの選択取消を AbortError として扱う', async () => {
    const plugin = createPlugin();
    plugin.pickTree = async () => {
      throw Object.assign(new Error('cancelled'), { code: 'PICK_CANCELLED' });
    };

    await expect(pickAndroidSafVault(plugin)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('設定解除では実ファイルを削除しない', async () => {
    const plugin = createPlugin({ selected: true, uri: 'content://saved', name: 'Obdisan' });
    await plugin.writeFile({ path: 'note.md', data: '# keep', encoding: 'utf8' });

    await forgetAndroidSafVault(plugin);

    expect(plugin.forgotten).toBe(true);
    await expect(plugin.readFile({ path: 'note.md', encoding: 'utf8' })).resolves.toEqual({ data: '# keep' });
  });
});
