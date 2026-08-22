import { Compartment, EditorState, type Extension, type StateEffect } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
  type KeyBinding,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands';
import { HighlightStyle, bracketMatching, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { markdown } from '@codemirror/lang-markdown';
import { tags } from '@lezer/highlight';

export interface EditorOptions {
  onChange: (text: string) => void;
  onSave: () => void;
  /** wikilinkExtension などを差し込む */
  extensions?: Extension[];
  extraKeymap?: KeyBinding[];
  showLineNumbers?: boolean;
}

const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading1, color: '#e2c8ff', fontWeight: '700', fontSize: '1.5em' },
  { tag: tags.heading2, color: '#d7bcff', fontWeight: '700', fontSize: '1.3em' },
  { tag: tags.heading3, color: '#cbb0fb', fontWeight: '600', fontSize: '1.15em' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], color: '#bfa5f5', fontWeight: '600' },
  { tag: tags.strong, color: '#f0d9a8', fontWeight: '700' },
  { tag: tags.emphasis, color: '#a8d8f0', fontStyle: 'italic' },
  { tag: tags.strikethrough, color: '#7a7a86', textDecoration: 'line-through' },
  { tag: tags.link, color: '#8ab4f8', textDecoration: 'underline' },
  { tag: tags.url, color: '#6f9ede' },
  { tag: tags.monospace, color: '#8be9c6' },
  { tag: tags.quote, color: '#9aa0a6', fontStyle: 'italic' },
  { tag: tags.list, color: '#c8a6ff' },
  { tag: tags.processingInstruction, color: '#5c5c66' },
  { tag: tags.contentSeparator, color: '#5c5c66' },
]);

const baseTheme = EditorView.theme(
  {
    '&': { color: 'var(--fg)', backgroundColor: 'transparent', height: '100%' },
    '.cm-line': { padding: '0 4px' },
    '.cm-tooltip': {
      background: 'var(--bg-elev)',
      border: '1px solid var(--border)',
      borderRadius: '6px',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      background: 'var(--accent-dim)',
      color: '#fff',
    },
    '.cm-tooltip-autocomplete > ul > li': { padding: '3px 8px' },
    '.cm-completionDetail': { color: 'var(--fg-faint)', fontStyle: 'normal', marginLeft: '10px' },
  },
  { dark: true },
);

/**
 * CodeMirror 6 の薄いラッパ。
 *
 * 記法を隠して見た目を整える Live Preview は Phase 2 で扱う (設計書 §7)。
 */
export class MarkdownEditor {
  readonly dom: HTMLElement;
  private readonly view: EditorView;
  /** setDoc による書き換えで onChange を発火させないためのフラグ */
  private suppress = false;

  private readonly gutterComp = new Compartment();

  constructor(private readonly opts: EditorOptions) {
    this.dom = document.createElement('div');
    this.dom.style.height = '100%';

    const extensions: Extension[] = [
      this.gutterComp.of(gutterExtension(opts.showLineNumbers ?? true)),
      highlightActiveLine(),
      drawSelection(),
      bracketMatching(),
      closeBrackets(),
      highlightSelectionMatches(),
      history(),
      markdown(),
      syntaxHighlighting(markdownHighlight),
      baseTheme,
      EditorView.lineWrapping,
      placeholder('Markdown で書く…   [[ でノートをリンク'),
      ...(opts.extensions ?? []),
      keymap.of([
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            this.opts.onSave();
            return true;
          },
        },
        ...(opts.extraKeymap ?? []),
        ...closeBracketsKeymap,
        ...completionKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !this.suppress) {
          this.opts.onChange(update.state.doc.toString());
        }
      }),
    ];

    this.view = new EditorView({
      state: EditorState.create({ doc: '', extensions }),
      parent: this.dom,
    });
  }

  /** 外部からの差し替え。onChange は発火しない。 */
  setDoc(text: string): void {
    this.suppress = true;
    try {
      this.view.dispatch({
        changes: { from: 0, to: this.view.state.doc.length, insert: text },
        selection: { anchor: 0 },
        scrollIntoView: true,
      });
    } finally {
      this.suppress = false;
    }
  }

  getDoc(): string {
    return this.view.state.doc.toString();
  }

  /** 指定オフセットへ移動して画面に入れる (バックリンクからの飛び先など) */
  revealOffset(offset: number): void {
    const pos = Math.max(0, Math.min(offset, this.view.state.doc.length));
    this.view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'center' }),
    });
    this.view.focus();
  }

  setLineNumbers(on: boolean): void {
    this.view.dispatch({ effects: this.gutterComp.reconfigure(gutterExtension(on)) });
  }

  /** 拡張へ合図を送る (例: インデックス更新後にリンク装飾を引き直す) */
  applyEffects(effects: StateEffect<unknown>[]): void {
    this.view.dispatch({ effects });
  }

  /** 選択範囲を before / after で囲む。選択が無ければ記号だけ入れて中にカーソルを置く。 */
  wrapSelection(before: string, after = before): void {
    const { from, to } = this.view.state.selection.main;
    const selected = this.view.state.doc.sliceString(from, to);
    this.view.dispatch({
      changes: { from, to, insert: `${before}${selected}${after}` },
      selection:
        selected === ''
          ? { anchor: from + before.length }
          : { anchor: from + before.length, head: from + before.length + selected.length },
    });
    this.view.focus();
  }

  /** 行頭の記号を付け外しする（見出し・箇条書き・引用など） */
  toggleLinePrefix(prefix: string): void {
    const state = this.view.state;
    const line = state.doc.lineAt(state.selection.main.head);
    const has = line.text.startsWith(prefix);
    this.view.dispatch({
      changes: has
        ? { from: line.from, to: line.from + prefix.length, insert: '' }
        : { from: line.from, insert: prefix },
      selection: {
        anchor: Math.max(
          line.from,
          state.selection.main.head + (has ? -prefix.length : prefix.length),
        ),
      },
    });
    this.view.focus();
  }

  undo(): void {
    undo(this.view);
    this.view.focus();
  }

  redo(): void {
    redo(this.view);
    this.view.focus();
  }

  insertAtCursor(text: string): void {
    const { from, to } = this.view.state.selection.main;
    this.view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    });
    this.view.focus();
  }

  focus(): void {
    this.view.focus();
  }

  destroy(): void {
    this.view.destroy();
  }
}

function gutterExtension(on: boolean): Extension {
  return on ? [lineNumbers(), highlightActiveLineGutter()] : [];
}
