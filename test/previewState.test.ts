// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { refreshPreview, shouldRecompute } from '../src/ui/previewState';

describe('選択移動とプレビューの更新', () => {
  it('同じ行内の選択では装飾を作り直さず、別の行・編集・外部更新では更新する', () => {
    const changes: boolean[] = [];
    const view = new EditorView({ state: EditorState.create({
      doc: '**bold text** and [[Note]]\nsecond line',
      extensions: [markdown(), EditorView.updateListener.of(update => changes.push(shouldRecompute(update)))],
    }) });
    try {
      view.dispatch({ selection: { anchor: 2, head: 5 } });
      expect(changes.at(-1)).toBe(false);
      view.dispatch({ selection: { anchor: 29 } });
      expect(changes.at(-1)).toBe(true);
      view.dispatch({ changes: { from: 29, insert: 'x' } });
      expect(changes.at(-1)).toBe(true);
      view.dispatch({ effects: refreshPreview.of(null) });
      expect(changes.at(-1)).toBe(true);
    } finally { view.destroy(); }
  });
});
