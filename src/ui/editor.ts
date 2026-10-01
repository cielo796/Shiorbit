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
import {
  defaultKeymap, history, historyKeymap, indentWithTab, redo, redoDepth, undo, undoDepth,
} from '@codemirror/commands';
import { HighlightStyle, bracketMatching, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap, search, openSearchPanel, setSearchQuery, getSearchQuery, SearchQuery } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap, completionKeymap, startCompletion } from '@codemirror/autocomplete';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { tags } from '@lezer/highlight';
import { SearchPanel, type SearchPanelOptions } from './search/SearchPanel';
import { searchSnapshot } from './search/searchState';
import { SearchHistory } from '../core/search/SearchHistory';
import type { TextMatch } from '../core/search/matches';
import { openContextMenu, type MenuItem } from './contextMenu';
import { promptDialog } from './dialog';
import { isAllowedPreviewUrl } from './htmlPreview';
import './search/searchPanel.css';

export type DocumentLanguage = 'markdown' | 'html';

export interface EditorOptions {
  onChange: (text: string) => void;
  onSave: () => void;
  /** カーソル移動やスクロール位置をアウトライン等へ通知する。 */
  onPositionChange?: (offset: number) => void;
  /** wikilinkExtension などを差し込む */
  extensions?: Extension[];
  extraKeymap?: KeyBinding[];
  showLineNumbers?: boolean;
  searchOptions?: SearchPanelOptions;
  /** 移行検証用。標準バーと比較できるようにしてから新UIへ一本化する。 */
  floatingSearch?: boolean;
  /** 選んだ画像をVaultへ保存し、現在ノートから参照する相対パスを返す。 */
  onPickImage?: () => Promise<string | null>;
  notify?: (message: string, isError?: boolean) => void;
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
/** エディタの見え方（カーソルとスクロール位置）。 */
export interface EditorViewState {
  anchor: number;
  head: number;
  scrollTop: number;
}

export class MarkdownEditor {
  readonly dom: HTMLElement;
  private readonly view: EditorView;
  /** setDoc による書き換えで onChange を発火させないためのフラグ */
  private suppress = false;
  private searchPanel: SearchPanel | null = null;
  private language: DocumentLanguage = 'markdown';

  private readonly gutterComp = new Compartment();
  private readonly languageComp = new Compartment();
  private readonly placeholderComp = new Compartment();

  constructor(private readonly opts: EditorOptions) {
    this.dom = document.createElement('div');
    this.dom.style.height = '100%';
    const searchOptions = opts.searchOptions ?? {
      history: new SearchHistory(), session: { replaceExpanded: false },
    };

    const extensions: Extension[] = [
      EditorState.allowMultipleSelections.of(true),
      ...(opts.floatingSearch === false ? [] : [
        search({ top: true, createPanel: (view) => {
          this.searchPanel = new SearchPanel(view, searchOptions);
          return this.searchPanel;
        } }),
        searchSnapshot,
      ]),
      this.gutterComp.of(gutterExtension(opts.showLineNumbers ?? true)),
      highlightActiveLine(),
      drawSelection(),
      bracketMatching(),
      closeBrackets(),
      highlightSelectionMatches(),
      history(),
      this.languageComp.of(markdown()),
      syntaxHighlighting(markdownHighlight),
      baseTheme,
      EditorView.lineWrapping,
      this.placeholderComp.of(placeholder('Markdown で書く…   [[ でノートをリンク')),
      EditorView.domEventHandlers({
        contextmenu: (event, view) => this.showEditorMenu(event, view),
      }),
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
        { key: 'Mod-f', preventDefault: true, run: () => this.openFind(false) },
        { key: 'Mod-h', preventDefault: true, run: () => this.openFind(true) },
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
        if (!this.suppress && (update.selectionSet || update.viewportChanged)) {
          const offset = update.selectionSet
            ? update.state.selection.main.head
            : update.view.viewport.from;
          this.opts.onPositionChange?.(offset);
        }
      }),
    ];

    this.view = new EditorView({
      state: EditorState.create({ doc: '', extensions }),
      parent: this.dom,
    });
  }

  /** 外部からの差し替え。onChange は発火しない。 */
  setDoc(text: string, view?: EditorViewState): void {
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
    if (view) this.setViewState(view);
  }

  /**
   * 読んでいた場所。ノートを切り替えて戻ってきたときに復元する。
   * 文書が変わっている可能性があるので、復元側で必ず範囲に丸める。
   */
  getViewState(): EditorViewState {
    const { anchor, head } = this.view.state.selection.main;
    return { anchor, head, scrollTop: this.view.scrollDOM.scrollTop };
  }

  setViewState(view: EditorViewState): void {
    const max = this.view.state.doc.length;
    const anchor = Math.max(0, Math.min(view.anchor, max));
    const head = Math.max(0, Math.min(view.head, max));
    this.suppress = true;
    try {
      this.view.dispatch({ selection: { anchor, head } });
    } finally {
      this.suppress = false;
    }
    // 行の高さが確定してからでないと戻せないので、測定のあとにもう一度当てる。
    this.view.scrollDOM.scrollTop = view.scrollTop;
    this.view.requestMeasure({
      read: () => null,
      write: () => {
        this.view.scrollDOM.scrollTop = view.scrollTop;
      },
    });
  }

  getDoc(): string {
    return this.view.state.doc.toString();
  }

  /** 専用UIの変更も通常の編集として扱い、Undo・自動保存・競合検査を通す。 */
  applyTextEdit(edit: { from: number; to: number; insert: string }): void {
    this.view.dispatch({ changes: edit, userEvent: 'input.tag' });
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

  /** 全ノート検索から移動した先でも同じクエリ・選択範囲を使う。 */
  revealSearchMatch(query: SearchQuery, match: TextMatch): void {
    openSearchPanel(this.view);
    const length = this.view.state.doc.length;
    this.view.dispatch({
      effects: [setSearchQuery.of(query), EditorView.scrollIntoView(Math.min(match.from, length), { y: 'center' })],
      selection: { anchor: Math.min(match.from, length), head: Math.min(match.to, length) },
      userEvent: 'select.search',
    });
  }

  private openFind(replace: boolean): boolean {
    const selection = this.view.state.selection.main;
    const selected = this.view.state.sliceDoc(selection.from, selection.to);
    openSearchPanel(this.view);
    if (selected) {
      const query = getSearchQuery(this.view.state);
      this.view.dispatch({ effects: setSearchQuery.of(new SearchQuery({
        ...query, search: query.literal ? selected : selected.replace(/\n/g, '\\n'),
      })) });
    }
    if (replace) this.searchPanel?.setReplaceExpanded(true);
    return true;
  }

  setLineNumbers(on: boolean): void {
    this.view.dispatch({ effects: this.gutterComp.reconfigure(gutterExtension(on)) });
  }

  setLanguage(language: DocumentLanguage): void {
    this.language = language;
    this.view.dispatch({
      effects: [
        this.languageComp.reconfigure(language === 'html' ? html() : markdown()),
        this.placeholderComp.reconfigure(placeholder(
          language === 'html' ? 'HTML を編集…' : 'Markdown で書く…   [[ でノートをリンク',
        )),
      ],
    });
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

  private showEditorMenu(event: MouseEvent, view: EditorView): boolean {
    if (this.language === 'markdown') return this.showMarkdownMenu(event, view);
    if (this.language === 'html') return this.showHtmlMenu(event, view);
    return false;
  }

  /** Markdownエディタの右クリックから、編集と頻出記法をまとめて実行する。 */
  private showMarkdownMenu(event: MouseEvent, view: EditorView): boolean {
    if (this.language !== 'markdown') return false;
    event.preventDefault();

    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    const selection = view.state.selection.main;
    if (pos !== null && (selection.empty || pos < selection.from || pos > selection.to)) {
      view.dispatch({ selection: { anchor: pos } });
    }

    const selected = this.selectedText();
    const canWriteClipboard = typeof navigator.clipboard?.writeText === 'function';
    const canReadClipboard = typeof navigator.clipboard?.readText === 'function';
    const section = (label: string): MenuItem => ({ label, section: true });
    openContextMenu(event.clientX, event.clientY, [
      section('編集'),
      { label: '元に戻す', enabled: undoDepth(view.state) > 0, run: () => this.undo() },
      { label: 'やり直す', enabled: redoDepth(view.state) > 0, run: () => this.redo() },
      { label: '切り取り', enabled: selected !== '' && canWriteClipboard, run: () => void this.copySelection(true) },
      { label: 'コピー', enabled: selected !== '' && canWriteClipboard, run: () => void this.copySelection(false) },
      { label: '貼り付け', enabled: canReadClipboard, run: () => void this.pasteClipboard() },
      { label: '選択範囲を削除', enabled: selected !== '', run: () => this.replaceSelection('') },
      { label: 'すべて選択', enabled: view.state.doc.length > 0, run: () => this.selectAll() },
      { label: '検索…', run: () => this.openFind(false) },
      {
        label: 'リンク・画像',
        children: [
          { label: 'PCから画像を追加…', enabled: this.opts.onPickImage !== undefined, run: () => void this.insertImageFromComputer() },
          { label: '画像パス・URLを挿入…', run: () => void this.promptImage() },
          { label: 'Webリンクを挿入…', run: () => void this.promptWebLink() },
          { label: 'Wikiリンクを挿入', run: () => this.insertWikilink(false) },
          { label: 'ノートを埋め込み', run: () => this.insertWikilink(true) },
        ],
      },
      {
        label: '文字装飾',
        children: [
          { label: '太字', run: () => this.wrapSelection('**') },
          { label: '斜体', run: () => this.wrapSelection('*') },
          { label: '取り消し線', run: () => this.wrapSelection('~~') },
          { label: 'ハイライト', run: () => this.wrapSelection('==') },
          { label: 'インラインコード', run: () => this.wrapSelection('`') },
        ],
      },
      {
        label: '段落・ブロック',
        children: [
          { label: '見出し1', run: () => this.setHeading(1) },
          { label: '見出し2', run: () => this.setHeading(2) },
          { label: '見出し3', run: () => this.setHeading(3) },
          { label: '箇条書き', run: () => this.toggleLinePrefix('- ') },
          { label: '番号付きリスト', run: () => this.toggleLinePrefix('1. ') },
          { label: 'タスクリスト', run: () => this.toggleLinePrefix('- [ ] ') },
          { label: '引用', run: () => this.toggleLinePrefix('> ') },
          { label: 'コードブロック', run: () => this.wrapBlock('```\n', '\n```') },
          { label: 'コールアウト', run: () => this.insertBlock('> [!NOTE] メモ\n> 内容') },
          { label: '表（3列）', run: () => this.insertBlock('| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n|  |  |  |') },
          { label: '区切り線', run: () => this.insertBlock('---') },
        ],
      },
    ]);
    return true;
  }

  /** HTMLソース編集用。Markdown固有記法を出さず、HTML要素の挿入に絞る。 */
  private showHtmlMenu(event: MouseEvent, view: EditorView): boolean {
    if (this.language !== 'html') return false;
    event.preventDefault();

    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    const selection = view.state.selection.main;
    if (pos !== null && (selection.empty || pos < selection.from || pos > selection.to)) {
      view.dispatch({ selection: { anchor: pos } });
    }

    const selected = this.selectedText();
    const canWriteClipboard = typeof navigator.clipboard?.writeText === 'function';
    const canReadClipboard = typeof navigator.clipboard?.readText === 'function';
    const section = (label: string): MenuItem => ({ label, section: true });
    openContextMenu(event.clientX, event.clientY, [
      section('編集'),
      { label: '元に戻す', enabled: undoDepth(view.state) > 0, run: () => this.undo() },
      { label: 'やり直す', enabled: redoDepth(view.state) > 0, run: () => this.redo() },
      { label: '切り取り', enabled: selected !== '' && canWriteClipboard, run: () => void this.copySelection(true) },
      { label: 'コピー', enabled: selected !== '' && canWriteClipboard, run: () => void this.copySelection(false) },
      { label: '貼り付け', enabled: canReadClipboard, run: () => void this.pasteClipboard() },
      { label: '選択範囲を削除', enabled: selected !== '', run: () => this.replaceSelection('') },
      { label: 'すべて選択', enabled: view.state.doc.length > 0, run: () => this.selectAll() },
      { label: '検索…', run: () => this.openFind(false) },
      {
        label: 'HTML挿入',
        children: [
          { label: 'リンク…', run: () => void this.promptHtmlLink() },
          { label: '画像…', run: () => void this.promptHtmlImage() },
          {
            label: '見出し',
            children: [1, 2, 3].map((level) => ({
              label: `見出し${level}`,
              run: () => this.wrapHtmlElement(`h${level}`, '見出し'),
            })),
          },
          {
            label: 'リスト',
            children: [
              { label: '箇条書き', run: () => this.insertHtmlList(false) },
              { label: '番号付きリスト', run: () => this.insertHtmlList(true) },
            ],
          },
          { label: '表', run: () => this.insertHtmlTable() },
          { label: '選択範囲をタグで囲む…', run: () => void this.promptHtmlWrap() },
        ],
      },
    ]);
    return true;
  }

  private selectedText(): string {
    const { from, to } = this.view.state.selection.main;
    return this.view.state.sliceDoc(from, to);
  }

  private replaceSelection(text: string): void {
    const { from, to } = this.view.state.selection.main;
    this.view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      userEvent: 'input.context-menu',
    });
    this.view.focus();
  }

  private selectAll(): void {
    this.view.dispatch({ selection: { anchor: 0, head: this.view.state.doc.length } });
    this.view.focus();
  }

  private async copySelection(cut: boolean): Promise<void> {
    const text = this.selectedText();
    if (text === '') return;
    try {
      await navigator.clipboard.writeText(text);
      if (cut) this.replaceSelection('');
    } catch (error) {
      this.opts.notify?.(message(error, 'クリップボードへ書き込めませんでした。'), true);
    }
  }

  private async pasteClipboard(): Promise<void> {
    try {
      this.replaceSelection(await navigator.clipboard.readText());
    } catch (error) {
      this.opts.notify?.(message(error, 'クリップボードを読み込めませんでした。'), true);
    }
  }

  private insertWikilink(embed: boolean): void {
    const selected = this.selectedText();
    const before = embed ? '![[' : '[[';
    const { from, to } = this.view.state.selection.main;
    this.view.dispatch({
      changes: { from, to, insert: `${before}${selected}]]` },
      selection: selected === ''
        ? { anchor: from + before.length }
        : { anchor: from + before.length, head: from + before.length + selected.length },
      userEvent: 'input.context-menu',
    });
    this.view.focus();
    if (selected === '') startCompletion(this.view);
  }

  /** モバイルツールバーからも使える画像選択。 */
  async insertImageFromComputer(): Promise<void> {
    try {
      const path = await this.opts.onPickImage?.();
      if (path) this.insertImageReference(path);
    } catch (error) {
      this.opts.notify?.(message(error, '画像を追加できませんでした。'), true);
    }
  }

  /** HTMLソースへ、Vaultに保存した画像の img 要素を挿入する。 */
  async insertHtmlImageFromComputer(): Promise<void> {
    try {
      const path = await this.opts.onPickImage?.();
      if (!path) return;
      const alt = escapeHtmlAttribute(this.selectedText().trim() || '画像');
      this.replaceSelection(`<img src="${escapeHtmlAttribute(path)}" alt="${alt}">`);
    } catch (error) {
      this.opts.notify?.(message(error, '画像を追加できませんでした。'), true);
    }
  }

  /** モバイルツールバーからも使う最小のHTML表。 */
  insertHtmlTable(): void {
    this.insertBlock('<table>\n  <thead><tr><th>列1</th><th>列2</th></tr></thead>\n  <tbody><tr><td></td><td></td></tr></tbody>\n</table>');
  }

  private async promptHtmlLink(): Promise<void> {
    const target = await promptDialog({
      title: 'HTMLリンクを挿入',
      label: 'URL または相対パス',
      value: 'https://',
      confirmLabel: '挿入',
      validate: (value) => isAllowedPreviewUrl(value)
        ? null : 'http、https、mailto、相対パスだけを使用できます。',
    });
    if (!target) return;
    const label = this.selectedText() || 'リンク';
    this.replaceSelection(`<a href="${escapeHtmlAttribute(target)}">${label}</a>`);
  }

  private async promptHtmlImage(): Promise<void> {
    const target = await promptDialog({
      title: 'HTML画像を挿入',
      label: 'Vault内の相対パス または画像URL',
      placeholder: 'images/photo.png または https://…',
      confirmLabel: '挿入',
      validate: (value) => isAllowedPreviewUrl(value) && !/^mailto:/i.test(value)
        ? null : 'http、https、相対パスの画像だけを使用できます。',
    });
    if (!target) return;
    const alt = escapeHtmlAttribute(this.selectedText().trim() || '画像');
    this.replaceSelection(`<img src="${escapeHtmlAttribute(target)}" alt="${alt}">`);
  }

  private wrapHtmlElement(tag: string, placeholderText: string): void {
    const selected = this.selectedText() || placeholderText;
    this.replaceSelection(`<${tag}>${selected}</${tag}>`);
  }

  private insertHtmlList(ordered: boolean): void {
    const tag = ordered ? 'ol' : 'ul';
    const selected = this.selectedText().trim();
    const lines = selected === '' ? ['項目'] : selected.split(/\r?\n/);
    const items = lines.map((line) => `  <li>${line}</li>`).join('\n');
    this.replaceSelection(`<${tag}>\n${items}\n</${tag}>`);
  }

  private async promptHtmlWrap(): Promise<void> {
    const tag = await promptDialog({
      title: 'タグで囲む',
      label: 'タグ名',
      placeholder: 'div、section、mark など',
      confirmLabel: '囲む',
      validate: validateHtmlTag,
    });
    if (!tag) return;
    this.wrapHtmlElement(tag.toLowerCase(), '内容');
  }

  private async promptImage(): Promise<void> {
    const target = await promptDialog({
      title: '画像を挿入',
      label: 'Vault内の画像パス または URL',
      placeholder: 'attachments/image.png または https://…',
      hint: 'Vault内の画像は埋め込み、URLはMarkdown画像として挿入します。',
      confirmLabel: '挿入',
      validate: (value) => /[\r\n]|\]\]/.test(value)
        ? '改行と ]] は画像パスに使えません。' : null,
    });
    if (!target) return;
    this.insertImageReference(target);
  }

  private insertImageReference(target: string): void {
    const selected = this.selectedText().replace(/[\]\n]/g, ' ').trim();
    if (/^(?:https?:)?\/\//i.test(target)) {
      const label = selected || '画像';
      this.replaceSelection(`![${escapeMarkdownLabel(label)}](${markdownUrl(target)})`);
    } else {
      const alias = selected === '' ? '' : `|${selected}`;
      this.replaceSelection(`![[${target}${alias}]]`);
    }
  }

  private async promptWebLink(): Promise<void> {
    const target = await promptDialog({
      title: 'Webリンクを挿入',
      label: 'URL',
      value: 'https://',
      confirmLabel: '挿入',
      validate: (value) => /^(?:https?:\/\/|mailto:)/i.test(value)
        ? null : 'http://、https://、mailto: のURLを入力してください。',
    });
    if (!target) return;
    const selected = this.selectedText();
    this.replaceSelection(`[${escapeMarkdownLabel(selected || 'リンク')}](${markdownUrl(target)})`);
  }

  private setHeading(level: number): void {
    const state = this.view.state;
    const line = state.doc.lineAt(state.selection.main.head);
    const existing = /^(#{1,6})\s+/.exec(line.text)?.[0] ?? '';
    const prefix = `${'#'.repeat(level)} `;
    const insert = line.text.startsWith(prefix) ? '' : prefix;
    this.view.dispatch({
      changes: { from: line.from, to: line.from + existing.length, insert },
      userEvent: 'input.context-menu',
    });
    this.view.focus();
  }

  private wrapBlock(before: string, after: string): void {
    const selected = this.selectedText();
    const body = selected || 'コード';
    this.replaceSelection(`${before}${body}${after}`);
  }

  private insertBlock(text: string): void {
    const { from, to } = this.view.state.selection.main;
    const doc = this.view.state.doc;
    const before = from > 0 && doc.sliceString(from - 1, from) !== '\n' ? '\n' : '';
    const after = to < doc.length && doc.sliceString(to, to + 1) !== '\n' ? '\n' : '';
    this.replaceSelection(`${before}${text}${after}`);
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

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
}

function markdownUrl(value: string): string {
  return value.replace(/[\s()]/g, (char) => encodeURIComponent(char));
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const BLOCKED_HTML_TAGS = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'base']);

function validateHtmlTag(value: string): string | null {
  if (!/^[a-z][a-z0-9-]*$/i.test(value)) return 'タグ名には英数字とハイフンだけを使用できます。';
  return BLOCKED_HTML_TAGS.has(value.toLowerCase()) ? 'このタグは安全なプレビューでは使用できません。' : null;
}
