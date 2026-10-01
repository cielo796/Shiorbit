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
  it('新規インストールでは Documents/Shiorbit を選ぶ', async () => {
    const fs = createFakeCapacitorFs();

    await expect(resolveNativeVaultDir(fs, 'Shiorbit')).resolves.toBe('Shiorbit');
  });

  it('綴りを誤っていた Documents/Obdisan を Documents/Shiorbit へ移行する', async () => {
    const fs = createFakeCapacitorFs();
    await addVault(fs, 'Obdisan');

    await expect(resolveNativeVaultDir(fs, 'Shiorbit')).resolves.toBe('Shiorbit');
    expect(fs.dump()).toContain('Shiorbit/note.md');
    expect(fs.dump()).not.toContain('Obdisan/note.md');
  });

  it('旧 Documents/Obidisan も Documents/Shiorbit へ移行する', async () => {
    const fs = createFakeCapacitorFs();
    await addVault(fs, 'Obidisan');

    await expect(resolveNativeVaultDir(fs, 'Shiorbit')).resolves.toBe('Shiorbit');
    expect(fs.dump()).toContain('Shiorbit/note.md');
  });

  it('Documents/Shiorbit が既にあれば旧フォルダより優先する', async () => {
    const fs = createFakeCapacitorFs();
    await addVault(fs, 'Shiorbit', 'current.md');
    await addVault(fs, 'Obdisan', 'old.md');

    await expect(resolveNativeVaultDir(fs, 'Shiorbit')).resolves.toBe('Shiorbit');
    expect(fs.dump()).toContain('Shiorbit/current.md');
    expect(fs.dump()).toContain('Obdisan/old.md');
  });

  it('明示された別フォルダは変更しない', async () => {
    const fs = createFakeCapacitorFs();
    await addVault(fs, 'Obdisan');

    await expect(resolveNativeVaultDir(fs, 'Custom')).resolves.toBe('Custom');
    expect(fs.dump()).toContain('Obdisan/note.md');
  });

  it('改名に失敗した場合は元の Vault を開く', async () => {
    const base = createFakeCapacitorFs();
    await addVault(base, 'Obdisan');
    const fs: CapFilesystem = { ...base, rename: vi.fn().mockRejectedValue(new Error('permission denied')) };

    await expect(resolveNativeVaultDir(fs, 'Shiorbit')).resolves.toBe('Obdisan');
    expect(base.dump()).toContain('Obdisan/note.md');
  });
});
