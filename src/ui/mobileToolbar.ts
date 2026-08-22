import type { MarkdownEditor } from './editor';
import { el } from './dom';

export interface MobileToolbarOptions {
  editor: () => MarkdownEditor | null;
}

interface Action {
  label: string;
  title: string;
  run: (editor: MarkdownEditor) => void;
}

const ACTIONS: Action[] = [
  { label: '[[', title: 'ノートへのリンク', run: (e) => e.wrapSelection('[[', ']]') },
  { label: '#', title: '見出し', run: (e) => e.toggleLinePrefix('# ') },
  { label: '- ', title: '箇条書き', run: (e) => e.toggleLinePrefix('- ') },
  { label: '☐', title: 'タスク', run: (e) => e.toggleLinePrefix('- [ ] ') },
  { label: 'B', title: '太字', run: (e) => e.wrapSelection('**') },
  { label: 'I', title: '斜体', run: (e) => e.wrapSelection('*') },
  { label: '`', title: 'コード', run: (e) => e.wrapSelection('`') },
  { label: '>', title: '引用', run: (e) => e.toggleLinePrefix('> ') },
  { label: '↩', title: '元に戻す', run: (e) => e.undo() },
  { label: '↪', title: 'やり直す', run: (e) => e.redo() },
];

/**
 * スマホ用の Markdown 記号ツールバー。
 *
 * ソフトキーボードで `[[` や `#` を打つのは想像以上に手間がかかる。
 * ここを省くとモバイルでの執筆が続かないので、設計段階から必須としていた（設計書 §7）。
 *
 * mousedown で preventDefault してキーボードを閉じさせないのが肝。
 */
export class MobileToolbar {
  readonly dom: HTMLElement;

  constructor(private readonly opts: MobileToolbarOptions) {
    this.dom = el('div', 'md-toolbar');

    for (const action of ACTIONS) {
      const b = el('button', 'md-key', action.label);
      b.title = action.title;
      b.type = 'button';
      // フォーカスを奪うとキーボードが閉じてしまう
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const editor = this.opts.editor();
        if (editor) action.run(editor);
      });
      this.dom.append(b);
    }
  }

  setVisible(visible: boolean): void {
    this.dom.style.display = visible ? '' : 'none';
  }
}
