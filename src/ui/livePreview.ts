import { syntaxTree } from '@codemirror/language';
import type { Extension, Range } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { isRevealed, revealedLines, shouldRecompute } from './previewState';
import { describeImage, imageReferences, MarkdownImageWidget, type MarkdownImageProvider } from './markdownImages';

/** 水平線 (---) の代わりに出す罫線 */
class RuleWidget extends WidgetType {
  // 状態を持たないので常に等価。再生成を防ぐために必須 (設計書 §7)
  override eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'cm-md-hr';
    return wrap;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

const hide = Decoration.replace({});
const ruleDeco = Decoration.replace({ widget: new RuleWidget() });
const inlineCode = Decoration.mark({ class: 'cm-md-code' });
const linkLabel = Decoration.mark({ class: 'cm-md-link' });
const quoteLine = Decoration.line({ class: 'cm-md-quote' });

interface Built {
  all: DecorationSet;
  hidden: DecorationSet;
}

function build(view: EditorView, enabled: boolean, images?: MarkdownImageProvider,
  refs?: () => ReturnType<typeof imageReferences>): Built {
  if (!enabled) return { all: Decoration.none, hidden: Decoration.none };

  const state = view.state;
  const revealed = revealedLines(state);
  const marks: Range<Decoration>[] = [];
  const hiddenRanges: Range<Decoration>[] = [];
  const quotedLines = new Set<number>();

  const conceal = (from: number, to: number): void => {
    if (to <= from) return;
    hiddenRanges.push(hide.range(from, to));
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (isRevealed(state, revealed, node.from)) return;
        const name = node.name;

        if (name === 'Image') {
          if (images && refs) {
            const image = describeImage(node.node, state.doc, refs);
            if (image) hiddenRanges.push(Decoration.replace({
              widget: new MarkdownImageWidget(image, images.context(), images),
            }).range(node.from, node.to));
          }
          return false;
        }

        // --- 見出しの # を隠す (後続の空白ごと)
        if (name === 'HeaderMark') {
          const parent = node.node.parent?.name ?? '';
          if (!parent.startsWith('ATXHeading')) return;
          let end = node.to;
          if (state.doc.sliceString(end, end + 1) === ' ') end += 1;
          conceal(node.from, end);
          return;
        }

        // --- 強調・打ち消しの記号を隠す
        if (name === 'EmphasisMark' || name === 'StrikethroughMark') {
          conceal(node.from, node.to);
          return;
        }

        // --- インラインコードのバッククォートを隠し、中身に色を付ける
        if (name === 'InlineCode') {
          const text = state.doc.sliceString(node.from, node.to);
          const ticks = /^`+/.exec(text)?.[0].length ?? 0;
          if (ticks === 0 || node.to - node.from <= ticks * 2) return;
          conceal(node.from, node.from + ticks);
          conceal(node.to - ticks, node.to);
          marks.push(inlineCode.range(node.from + ticks, node.to - ticks));
          return;
        }

        // --- [表示テキスト](URL) を「表示テキスト」だけにする
        if (name === 'Link') {
          const text = state.doc.sliceString(node.from, node.to);
          if (text.startsWith('!')) return; // 画像はそのまま
          const close = text.indexOf('](');
          if (!text.startsWith('[') || close < 0) return;
          conceal(node.from, node.from + 1);
          conceal(node.from + close, node.to);
          marks.push(linkLabel.range(node.from + 1, node.from + close));
          return;
        }

        // --- 引用の > を隠して左罫線にする
        if (name === 'QuoteMark') {
          let end = node.to;
          if (state.doc.sliceString(end, end + 1) === ' ') end += 1;
          conceal(node.from, end);
          quotedLines.add(state.doc.lineAt(node.from).number);
          return;
        }

        // --- 水平線を罫線に置き換える
        if (name === 'HorizontalRule') {
          hiddenRanges.push(ruleDeco.range(node.from, node.to));
        }
      },
    });
  }

  for (const n of quotedLines) {
    marks.push(quoteLine.range(state.doc.line(n).from));
  }

  return {
    all: Decoration.set([...marks, ...hiddenRanges], true),
    hidden: Decoration.set(hiddenRanges, true),
  };
}

const theme = EditorView.baseTheme({
  '.cm-md-image': { display: 'inline-block', maxWidth: '100%', verticalAlign: 'top' },
  '.cm-md-image img': { display: 'block', maxWidth: '100%', height: 'auto', borderRadius: '6px' },
  '.cm-md-code': {
    background: 'var(--bg-elev)',
    borderRadius: '3px',
    padding: '0 3px',
  },
  '.cm-md-link': { color: '#8ab4f8', textDecoration: 'underline', cursor: 'pointer' },
  '.cm-md-quote': {
    borderLeft: '3px solid var(--border)',
    paddingLeft: '10px',
    color: 'var(--fg-dim)',
  },
  '.cm-md-hr': {
    display: 'inline-block',
    width: '100%',
    borderTop: '1px solid var(--border)',
    verticalAlign: 'middle',
  },
});

/**
 * Live Preview — 記法を隠して読みやすくする (設計書 §7)。
 *
 * カーソルが乗っている行だけは生の Markdown を見せるので、いつでも編集できる。
 * 隠した範囲は atomicRanges に登録してあり、カーソルが中に迷い込まない。
 * 動作が気に入らなければ設定でオフにできる。
 */
export function livePreview(enabled: () => boolean, images?: MarkdownImageProvider): Extension {
  let referenceTree: ReturnType<typeof syntaxTree> | null = null;
  let references: ReturnType<typeof imageReferences> = new Map();
  const draw = (view: EditorView): Built => build(view, enabled(), images, () => {
    const tree = syntaxTree(view.state);
    if (tree !== referenceTree) {
      references = imageReferences(tree, view.state.doc);
      referenceTree = tree;
    }
    return references;
  });
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      hidden: DecorationSet;

      constructor(view: EditorView) {
        const built = draw(view);
        this.decorations = built.all;
        this.hidden = built.hidden;
      }

      update(update: ViewUpdate): void {
        if (!shouldRecompute(update)) return;
        const built = draw(update.view);
        this.decorations = built.all;
        this.hidden = built.hidden;
      }
    },
    { decorations: (v) => v.decorations },
  );

  return [
    theme,
    plugin,
    // 隠した範囲だけを不可分にする。装飾全体を対象にすると
    // 太字の中にカーソルを置けなくなってしまう。
    EditorView.atomicRanges.of((view) => view.plugin(plugin)?.hidden ?? Decoration.none),
  ];
}
