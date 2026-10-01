import { syntaxTree } from '@codemirror/language';
import type { EditorState, Extension, Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { isRevealed, revealedLines, shouldRecompute } from './previewState';
import { EmbedWidget, type EmbedProvider } from './embed/embedWidget';

export { refreshPreview as refreshWikilinks } from './previewState';

export interface WikilinkSuggestion {
  /** 挿入されるリンク先 */
  target: string;
  label: string;
  detail: string;
}

/**
 * エディタが「いま何が解決できるか」を知るための窓口。
 * App 側が Indexer を見て答える。エディタは Indexer を直接知らない。
 */
export interface WikilinkProvider {
  isResolved: (target: string) => boolean;
  /** aside=true なら隣のペインで開く（Ctrl+Alt+クリック） */
  follow: (target: string, aside?: boolean) => void;
  suggest: () => WikilinkSuggestion[];
  /** ![[...]] の中身。省略すると埋め込みは記法のまま表示される。 */
  embeds?: EmbedProvider;
}

export interface WikilinkOptions {
  /** true なら [[ ]] を隠して表示名だけ見せる (Live Preview) */
  conceal: () => boolean;
}

const WIKILINK = /(!?)\[\[([^\[\]\n]+?)\]\]/g;

const resolvedMark = Decoration.mark({ class: 'cm-wikilink' });
const unresolvedMark = Decoration.mark({ class: 'cm-wikilink cm-wikilink-unresolved' });
const hide = Decoration.replace({});

function targetOf(inner: string): string {
  return splitInner(inner).target;
}

/** "AI/Ollama#見出し|別名" を分ける。target は .md を落とした形。 */
function splitInner(inner: string): { target: string; subpath?: string } {
  let rest = inner;
  const pipe = rest.indexOf('|');
  if (pipe >= 0) rest = rest.slice(0, pipe);
  const hash = rest.indexOf('#');
  const subpath = hash >= 0 ? rest.slice(hash).trim() : undefined;
  if (hash >= 0) rest = rest.slice(0, hash);
  const target = rest.trim().replace(/\.md$/i, '');
  return subpath === undefined || subpath === '#' ? { target } : { target, subpath };
}

/** コードブロック・インラインコードの中かどうか (誤ってリンク扱いしないため) */
function inCode(state: EditorState, pos: number): boolean {
  let node = syntaxTree(state).resolveInner(pos, 1) as { name: string; parent: unknown } | null;
  while (node) {
    if (/Code|Comment/.test(node.name)) return true;
    node = node.parent as { name: string; parent: unknown } | null;
  }
  return false;
}

interface Built {
  all: DecorationSet;
  hidden: DecorationSet;
}

function build(view: EditorView, provider: WikilinkProvider, conceal: boolean): Built {
  const state = view.state;
  const revealed = revealedLines(state);
  const marks: Range<Decoration>[] = [];
  const hiddenRanges: Range<Decoration>[] = [];

  for (const { from, to } of view.visibleRanges) {
    const text = state.doc.sliceString(from, to);

    for (const m of text.matchAll(WIKILINK)) {
      const start = from + m.index;
      const inner = m[2] ?? '';
      const embed = m[1] === '!';
      if (inCode(state, start + 2)) continue;

      const { target, subpath } = splitInner(inner);
      if (target === '') continue;

      const deco = provider.isResolved(target) ? resolvedMark : unresolvedMark;
      const end = start + m[0].length;
      const raw = !conceal || isRevealed(state, revealed, start);

      // 埋め込みは中身に差し替える。カーソル行と Live Preview 無効時は記法のまま。
      if (embed) {
        if (raw || !provider.embeds) marks.push(deco.range(start, end));
        else {
          hiddenRanges.push(
            Decoration.replace({ widget: new EmbedWidget(target, subpath, provider.embeds) })
              .range(start, end),
          );
        }
        continue;
      }

      if (raw) {
        marks.push(deco.range(start, end));
        continue;
      }

      const innerStart = start + 2;
      const innerEnd = innerStart + inner.length;
      const pipe = inner.indexOf('|');
      const visibleStart = pipe >= 0 ? innerStart + pipe + 1 : innerStart;

      hiddenRanges.push(hide.range(start, visibleStart));
      hiddenRanges.push(hide.range(innerEnd, end));
      if (visibleStart < innerEnd) marks.push(deco.range(visibleStart, innerEnd));
    }
  }

  return {
    all: Decoration.set([...marks, ...hiddenRanges], true),
    hidden: Decoration.set(hiddenRanges, true),
  };
}

/** [[...]] のオートコンプリート */
function wikilinkCompletion(provider: WikilinkProvider) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const before = ctx.matchBefore(/\[\[[^\[\]\n]*/);
    if (!before) return null;

    const options: Completion[] = provider.suggest().map((s) => ({
      label: s.label,
      detail: s.detail,
      type: 'text',
      apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
        const after = view.state.doc.sliceString(to, to + 2);
        const insert = after === ']]' ? s.target : `${s.target}]]`;
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: from + s.target.length + 2 },
        });
      },
    }));

    return { from: before.from + 2, options, validFor: /^[^\[\]\n]*$/ };
  };
}

/** カーソル位置の [[...]] を探す */
function linkAt(state: EditorState, pos: number): string | null {
  const line = state.doc.lineAt(pos);
  for (const m of line.text.matchAll(WIKILINK)) {
    const start = line.from + m.index;
    const end = start + m[0].length;
    if (pos >= start && pos <= end) {
      const target = targetOf(m[2] ?? '');
      return target === '' ? null : target;
    }
  }
  return null;
}

const theme = EditorView.baseTheme({
  '.cm-embed': { display: 'inline-block', maxWidth: '100%', verticalAlign: 'top', cursor: 'pointer' },
  '.cm-embed-loading, .cm-embed-missing': {
    color: 'var(--fg-faint)', fontSize: '0.9em', fontStyle: 'italic',
  },
  '.cm-embed-missing': { color: 'var(--unresolved)' },
  '.cm-embed-image': {
    display: 'block', maxWidth: '100%', height: 'auto',
    borderRadius: '6px', border: '1px solid var(--border)',
  },
  '.cm-embed-note': {
    display: 'block', borderLeft: '3px solid var(--accent-dim)',
    background: 'var(--bg-elev)', borderRadius: '4px',
    padding: '6px 10px', margin: '2px 0',
  },
  '.cm-embed-title': {
    display: 'block', fontSize: '0.85em', color: 'var(--fg-faint)', marginBottom: '2px',
  },
  '.cm-embed-body': { display: 'block', whiteSpace: 'pre-wrap', color: 'var(--fg-dim)' },
  '.cm-wikilink': { color: 'var(--accent)', cursor: 'pointer' },
  '.cm-wikilink:hover': { textDecoration: 'underline' },
  '.cm-wikilink-unresolved': { color: 'var(--unresolved)', opacity: '0.85' },
});

/**
 * [[WikiLink]] のための CodeMirror 拡張。
 *
 * - 解決済み / 未解決を色分けする
 * - Live Preview が有効なら [[ ]] を隠し、表示名だけを見せる
 * - Ctrl (Mac は Cmd) + クリック、または Ctrl+Enter で移動する
 *   (素のクリックを移動に使うとリンク内にカーソルを置けなくなるため)
 * - [[ を打つと候補を出す
 */
export function wikilinkExtension(provider: WikilinkProvider, options: WikilinkOptions): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      hidden: DecorationSet;

      constructor(view: EditorView) {
        const built = build(view, provider, options.conceal());
        this.decorations = built.all;
        this.hidden = built.hidden;
      }

      update(update: ViewUpdate): void {
        if (!shouldRecompute(update)) return;
        const built = build(update.view, provider, options.conceal());
        this.decorations = built.all;
        this.hidden = built.hidden;
      }
    },
    { decorations: (v) => v.decorations },
  );

  return [
    theme,
    plugin,
    EditorView.atomicRanges.of((view) => view.plugin(plugin)?.hidden ?? Decoration.none),
    EditorView.domEventHandlers({
      mousedown: (event, view) => {
        if (!(event.metaKey || event.ctrlKey)) return false;
        const el = (event.target as HTMLElement | null)?.closest?.('.cm-wikilink');
        if (!el) return false;
        const pos = view.posAtDOM(el);
        const target = linkAt(view.state, pos) ?? linkAt(view.state, pos + 2);
        if (target === null) return false;
        event.preventDefault();
        provider.follow(target, event.altKey);
        return true;
      },
    }),
    autocompletion({ override: [wikilinkCompletion(provider)] }),
  ];
}

/** Ctrl+Enter でカーソル位置のリンクを開く */
export function followLinkCommand(provider: WikilinkProvider) {
  return (view: EditorView): boolean => {
    const target = linkAt(view.state, view.state.selection.main.head);
    if (target === null) return false;
    provider.follow(target);
    return true;
  };
}
