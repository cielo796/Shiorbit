import { describe, expect, it, vi } from 'vitest';
import { MemoryAdapter } from '../src/adapters/memory';
import { VaultService } from '../src/core/vault/VaultService';
import { DocumentCreator } from '../src/ui/documentCreator';

function setup(): {
  adapter: MemoryAdapter;
  creator: DocumentCreator;
  open: ReturnType<typeof vi.fn>;
} {
  const adapter = new MemoryAdapter('New document');
  const vault = new VaultService(adapter);
  const open = vi.fn(async () => undefined);
  const creator = new DocumentCreator({
    vault: () => vault,
    index: () => null,
    settings: () => null,
    editor: () => null,
    currentPath: () => 'AI/current.md',
    refreshTree: vi.fn(async () => undefined),
    open,
    toast: vi.fn(),
  });
  return { adapter, creator, open };
}

describe('DocumentCreator', () => {
  it('拡張子を省略した名前は Markdown として現在のフォルダに作る', async () => {
    const { adapter, creator, open } = setup();

    await creator.fromName('New note');

    expect(await adapter.exists('AI/New note.md')).toBe(true);
    expect(await adapter.read('AI/New note.md')).toBe('# New note\n\n');
    expect(open).toHaveBeenCalledWith('AI/New note.md');
  });

  it('HTML 拡張子を指定した名前は HTML テンプレートで作る', async () => {
    const { adapter, creator, open } = setup();

    await creator.fromName('Guide.html');

    expect(await adapter.exists('AI/Guide.html')).toBe(true);
    expect(await adapter.exists('AI/Guide.html.md')).toBe(false);
    expect(await adapter.read('AI/Guide.html')).toContain('<!doctype html>');
    expect(await adapter.read('AI/Guide.html')).toContain('<h1>Guide</h1>');
    expect(open).toHaveBeenCalledWith('AI/Guide.html');
  });
});
