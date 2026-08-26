import { describe, expect, it, vi } from 'vitest';
import type { CapFilesystem } from '../src/adapters/capacitor';
import { resolveNativeVaultDir } from '../src/adapters/nativeVault';
import { createFakeCapacitorFs } from './fakeCapacitorFs';

async function addVault(fs: CapFilesystem, dir: string, file = 'note.md'): Promise<void> {
  await fs.mkdir({ path: dir, directory: 'DOCUMENTS', recursive: true });
  await fs.writeFile({
    path: `${dir}/${file}`,
    directory: 'DOCUMENTS',
    data: '# test',
    encoding: 'utf8',
  });
}

describe('resolveNativeVaultDir', () => {
  it('新規インストールでは Documents/Obdisan を選ぶ', async () => {
    const fs = createFakeCapacitorFs();

    await expect(resolveNativeVaultDir(fs, 'Obdisan')).resolves.toBe('Obdisan');
  });

  it('Documents/Shiorbit を Documents/Obdisan へ移行する', async () => {
    const fs = createFakeCapacitorFs();
    await addVault(fs, 'Shiorbit');

    await expect(resolveNativeVaultDir(fs, 'Obdisan')).resolves.toBe('Obdisan');
    expect(fs.dump()).toContain('Obdisan/note.md');
    expect(fs.dump()).not.toContain('Shiorbit/note.md');
  });

  it('旧 Documents/Obidisan も Documents/Obdisan へ移行する', async () => {
    const fs = createFakeCapacitorFs();
    await addVault(fs, 'Obidisan');

    await expect(resolveNativeVaultDir(fs, 'Obdisan')).resolves.toBe('Obdisan');
    expect(fs.dump()).toContain('Obdisan/note.md');
  });

  it('Documents/Obdisan が既にあれば旧フォルダより優先する', async () => {
    const fs = createFakeCapacitorFs();
    await addVault(fs, 'Obdisan', 'current.md');
    await addVault(fs, 'Shiorbit', 'old.md');

    await expect(resolveNativeVaultDir(fs, 'Obdisan')).resolves.toBe('Obdisan');
    expect(fs.dump()).toContain('Obdisan/current.md');
    expect(fs.dump()).toContain('Shiorbit/old.md');
  });

  it('明示された別フォルダは変更しない', async () => {
    const fs = createFakeCapacitorFs();
    await addVault(fs, 'Shiorbit');

    await expect(resolveNativeVaultDir(fs, 'Custom')).resolves.toBe('Custom');
    expect(fs.dump()).toContain('Shiorbit/note.md');
  });

  it('改名に失敗した場合は元の Vault を開く', async () => {
    const base = createFakeCapacitorFs();
    await addVault(base, 'Shiorbit');
    const fs: CapFilesystem = { ...base, rename: vi.fn().mockRejectedValue(new Error('permission denied')) };

    await expect(resolveNativeVaultDir(fs, 'Obdisan')).resolves.toBe('Shiorbit');
    expect(base.dump()).toContain('Shiorbit/note.md');
  });
});
