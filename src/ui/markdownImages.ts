import type { SyntaxNode, Tree } from '@lezer/common';
import type { Text } from '@codemirror/state';
import { EditorView, WidgetType } from '@codemirror/view';
import { el } from './dom';

export interface MarkdownImageProvider {
  context: () => string;
  resolve: (target: string, context: string) => Promise<string | null>;
}

interface ImageDescription { target: string; alt: string; title?: string }
const labelKey = (text: string): string => text.trim().replace(/\s+/g, ' ').toLowerCase();

function unescape(text: string): string {
  return text.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~])/g, '$1')
    .replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity) => {
      const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
      const found = named[entity.toLowerCase()];
      if (found !== undefined) return found;
      const hex = entity[2]?.toLowerCase() === 'x';
      const point = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point) : '\ufffd';
    });
}

function destination(node: SyntaxNode, doc: Text): { target: string; title?: string } | null {
  const url = node.getChild('URL');
  if (!url) return null;
  const raw = doc.sliceString(url.from, url.to);
  const title = node.getChild('LinkTitle');
  return {
    target: unescape(raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw),
    ...(title ? { title: unescape(doc.sliceString(title.from + 1, title.to - 1)) } : {}),
  };
}

/** 参照画像があるときだけ構築し、構文木が変わるまで使い回す。 */
export function imageReferences(tree: Tree, doc: Text): Map<string, { target: string; title?: string }> {
  const refs = new Map<string, { target: string; title?: string }>();
  tree.iterate({ enter(node) {
    if (node.name !== 'LinkReference') return;
    const label = node.node.getChild('LinkLabel');
    const value = destination(node.node, doc);
    if (!label || !value) return false;
    const key = labelKey(unescape(doc.sliceString(label.from + 1, label.to - 1)));
    if (!refs.has(key)) refs.set(key, value);
    return false;
  } });
  return refs;
}

/** 正規表現で全文を走査せず、Markdown構文木の画像だけを対象にする。 */
export function describeImage(node: SyntaxNode, doc: Text, refs: () => ReturnType<typeof imageReferences>): ImageDescription | null {
  // ViewPlugin の置換は改行をまたげない。複数行記法は編集可能なソースのまま残す。
  if (doc.lineAt(node.from).number !== doc.lineAt(node.to).number) return null;
  const marks = node.getChildren('LinkMark');
  const close = marks.find(mark => doc.sliceString(mark.from, mark.to) === ']');
  if (!close) return null;
  const alt = unescape(doc.sliceString(node.from + 2, close.from));
  const inline = destination(node, doc);
  if (inline) return { ...inline, alt };
  const label = node.getChild('LinkLabel');
  const key = label ? unescape(doc.sliceString(label.from + 1, label.to - 1)) || alt : alt;
  const reference = refs().get(labelKey(key));
  return reference ? { ...reference, alt } : null;
}

export class MarkdownImageWidget extends WidgetType {
  constructor(
    private readonly image: ImageDescription,
    private readonly context: string,
    private readonly provider: MarkdownImageProvider,
  ) { super(); }

  override eq(other: MarkdownImageWidget): boolean {
    return other.context === this.context && other.image.target === this.image.target
      && other.image.alt === this.image.alt && other.image.title === this.image.title
      && other.provider === this.provider;
  }

  override toDOM(view: EditorView): HTMLElement {
    const host = el('span', 'cm-md-image');
    host.append(el('span', 'cm-embed-loading', this.image.alt || '画像を読み込み中…'));
    void this.fill(host, view);
    return host;
  }

  override ignoreEvent(): boolean { return false; }

  private async fill(host: HTMLElement, view: EditorView): Promise<void> {
    let url: string | null;
    try { url = await this.provider.resolve(this.image.target, this.context); } catch { url = null; }
    if (!host.isConnected) return;
    const missing = (): void => {
      if (!host.isConnected) return;
      host.replaceChildren(el('span', 'cm-embed-missing', `画像を表示できません: ${this.image.alt || this.image.target}`));
      host.title = this.image.target;
      view.requestMeasure();
    };
    if (url === null) { missing(); return; }
    const image = el('img', 'cm-embed-image');
    image.alt = this.image.alt;
    if (this.image.title) image.title = this.image.title;
    image.draggable = false;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('load', () => { if (host.isConnected) view.requestMeasure(); });
    image.addEventListener('error', missing);
    image.src = url;
    host.replaceChildren(image);
    view.requestMeasure();
  }
}
