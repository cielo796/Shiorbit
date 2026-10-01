// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { BacklinksPane } from '../src/ui/backlinksPane';
import { UnresolvedPane } from '../src/ui/unresolvedPane';
import { MAX_CONTEXT_LENGTH } from '../src/core/text/excerpt';

describe('古い巨大文脈をDOMへ渡さない', () => {
  const ref = { raw: 'b.md', target: 'b.md', embed: false, from: 123, to: 127 };
  const context = 'x'.repeat(8 * 1024 * 1024);

  it('リンク元の表示を制限し、クリック先の元本文座標は変えない', () => {
    const onOpen = vi.fn();
    const pane = new BacklinksPane({ onOpen, onCreate: vi.fn() });
    pane.setNote('b.md', [{ from: 'a.html', ref, context }], []);
    const line = pane.dom.querySelector<HTMLElement>('.backlink-context')!;
    expect(line.textContent!.length).toBeLessThanOrEqual(MAX_CONTEXT_LENGTH);
    line.click();
    expect(onOpen).toHaveBeenCalledWith('a.html', 123);
  });

  it('未解決リンクのツールチップにも巨大な文脈を持ち込まない', () => {
    const pane = new UnresolvedPane({ onOpen: vi.fn(), onCreate: vi.fn() });
    pane.setGroups([{ name: 'b', sources: [{ path: 'a.html', ref, context }] }]);
    expect(pane.dom.querySelector<HTMLElement>('.unresolved-source')!.title.length)
      .toBeLessThanOrEqual('a.html: '.length + MAX_CONTEXT_LENGTH);
  });
});
