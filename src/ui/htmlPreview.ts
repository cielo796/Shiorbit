import { isRasterDataImage } from './embed/imageSource';

const BLOCKED_ELEMENTS = 'script, iframe, frame, frameset, object, embed, base';
const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'poster', 'xlink:href']);
const ALLOWED_URL_SCHEMES = new Set(['http', 'https', 'mailto']);
const URL_SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const URL_CONTROL = /[\u0000-\u001f\u007f]/;

/** data: は通常禁止。HTMLのimg.srcだけに、Base64のラスター画像を許可する。 */
function isEmbeddedRasterImage(element: Element, attribute: string, value: string): boolean {
  if (attribute !== 'src' || element.localName !== 'img' || element.namespaceURI !== 'http://www.w3.org/1999/xhtml') return false;
  return isRasterDataImage(value);
}

export interface HtmlPreviewOptions {
  /** 表示倍率。1 以外のときだけ文書側へ zoom を差し込む。 */
  zoom?: number;
  /** 表示直後に送る見出し。scanDocument が数えた順番と同じ番号を渡す。 */
  headingIndex?: number;
}

/**
 * 位置合わせ用に振る id の接頭辞。
 *
 * プレビューは opaque origin の iframe なので、外から scrollTop を読み書きできない。
 * 送れるのはフラグメント（#id）だけなので、見出しに番号つきの id を用意しておく。
 */
export const HEADING_ANCHOR_PREFIX = 'shiorbit-h';

export interface SanitizedPreview {
  html: string;
  /** 見出しの並び順に対応する id。元から id があるものはそれを使う。 */
  anchors: string[];
}

/**
 * HTML の URL 属性に残してよい値か。
 * 明示的な scheme は http / https / mailto だけを許可し、それ以外は相対参照として扱う。
 */
export function isAllowedPreviewUrl(value: string): boolean {
  const url = value.trim();
  if (url === '' || URL_CONTROL.test(url)) return false;
  const scheme = URL_SCHEME.exec(url)?.[1]?.toLowerCase();
  return scheme === undefined || ALLOWED_URL_SCHEMES.has(scheme);
}

/**
 * HTMLプレビュー用の防御的サニタイズ。
 * iframe sandbox でも実行を止めるが、危険な記述自体も渡さない二重防御にする。
 */
export function buildHtmlPreview(source: string, options: HtmlPreviewOptions = {}): SanitizedPreview {
  const { doc, anchors } = buildPreviewDocument(source, options);
  return { html: `<!doctype html>\n${doc.documentElement.outerHTML}`, anchors };
}

function buildPreviewDocument(source: string, options: HtmlPreviewOptions): { doc: Document; anchors: string[] } {
  const doc = new DOMParser().parseFromString(source, 'text/html');

  for (const element of doc.querySelectorAll(BLOCKED_ELEMENTS)) element.remove();
  for (const meta of doc.querySelectorAll('meta[http-equiv]')) {
    if (meta.getAttribute('http-equiv')?.toLowerCase() === 'refresh') meta.remove();
  }

  for (const element of doc.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith('on') || (URL_ATTRIBUTES.has(name) && !isAllowedPreviewUrl(value) && !isEmbeddedRasterImage(element, name, value))) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  const anchors = markHeadings(doc);
  applyZoom(doc, options.zoom ?? 1);
  return { doc, anchors };
}

export function sanitizeHtmlPreview(source: string, options: HtmlPreviewOptions = {}): string {
  return buildHtmlPreview(source, options).html;
}

/**
 * 見出しに位置合わせ用の id を振る。
 * 既に id があるものは書き換えない（文書内リンクを壊さないため）。
 */
function markHeadings(doc: Document): string[] {
  const anchors: string[] = [];
  doc.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((heading, index) => {
    const existing = heading.getAttribute('id');
    if (existing !== null && existing !== '') {
      anchors.push(existing);
      return;
    }
    const id = `${HEADING_ANCHOR_PREFIX}${index}`;
    heading.setAttribute('id', id);
    anchors.push(id);
  });
  return anchors;
}

/**
 * 文書の内側を拡大する。
 *
 * iframe 側に掛けると外側のレイアウトまで巻き込むので、文書のルートに掛ける。
 * 既存のスタイルより後に足して、利用者の CSS を書き換えずに上書きする。
 */
function applyZoom(doc: Document, zoom: number): void {
  if (!Number.isFinite(zoom) || zoom === 1) return;
  const style = doc.createElement('style');
  style.textContent = `:root { zoom: ${zoom}; }`;
  (doc.head ?? doc.documentElement).append(style);
}

export function createHtmlPreviewFrame(): HTMLIFrameElement {
  const frame = document.createElement('iframe');
  frame.className = 'html-preview';
  frame.title = 'HTMLプレビュー';
  frame.setAttribute('sandbox', '');
  frame.referrerPolicy = 'no-referrer';
  return frame;
}

/**
 * Electron/Chromiumでも確実に再描画されるよう、サニタイズ済み文書を
 * opaque origin の data URL として読み込む。sandboxにはscript権限を与えない。
 */
export function createHtmlPreviewUrl(source: string, options: HtmlPreviewOptions = {}): string {
  const { html, anchors } = buildHtmlPreview(source, options);
  return previewDataUrl(html, anchors, options.headingIndex);
}

/**
 * 相対画像だけを呼び出し側で解決し、サニタイズ済み文書の src を Object URL 等へ置き換える。
 * 外部 URL と許可されない scheme は resolver へ渡さない。
 */
export async function createHtmlPreviewUrlWithImages(
  source: string,
  resolveImage: (src: string) => Promise<string | null>,
  options: HtmlPreviewOptions = {},
): Promise<string> {
  const { html, anchors } = await buildPreviewWithImages(source, resolveImage, options);
  return previewDataUrl(html, anchors, options.headingIndex);
}

export interface HtmlPreviewResource {
  url: string;
  dispose: () => void;
}

/** Blob文書なら巨大HTMLをURLへ再エンコードせず、Chromiumのdata-originエラーも避けられる。 */
export async function createHtmlPreviewResourceWithImages(
  source: string,
  resolveImage: (src: string) => Promise<string | null>,
  options: HtmlPreviewOptions = {},
): Promise<HtmlPreviewResource> {
  const { html, anchors } = await buildPreviewWithImages(source, resolveImage, options);
  if (typeof URL.createObjectURL !== 'function' || typeof URL.revokeObjectURL !== 'function') {
    return { url: previewDataUrl(html, anchors, options.headingIndex), dispose: () => {} };
  }
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  let disposed = false;
  return {
    url: withHeading(url, anchors, options.headingIndex),
    dispose: () => { if (!disposed) { disposed = true; URL.revokeObjectURL(url); } },
  };
}

async function buildPreviewWithImages(
  source: string,
  resolveImage: (src: string) => Promise<string | null>,
  options: HtmlPreviewOptions,
): Promise<SanitizedPreview> {
  const { doc, anchors } = buildPreviewDocument(source, options);
  const images = [...doc.querySelectorAll<HTMLImageElement>('img[src]')];
  const resolved = new Map<string, string | null>();
  const sources = [...new Set(images
    .map((image) => image.getAttribute('src')?.trim() ?? '')
    .filter(isLocalImageReference))];
  await Promise.all(sources.map(async (src) => resolved.set(src, await resolveImage(src))));
  for (const image of images) {
    const src = image.getAttribute('src')?.trim() ?? '';
    const url = resolved.get(src);
    if (url) image.setAttribute('src', url);
  }

  return { html: `<!doctype html>\n${doc.documentElement.outerHTML}`, anchors };
}

export function renderHtmlPreview(
  frame: HTMLIFrameElement,
  source: string,
  options: HtmlPreviewOptions = {},
): void {
  frame.removeAttribute('srcdoc');
  frame.src = createHtmlPreviewUrl(source, options);
}

function previewDataUrl(html: string, anchors: readonly string[], headingIndex?: number): string {
  return withHeading(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`, anchors, headingIndex);
}

function withHeading(url: string, anchors: readonly string[], headingIndex?: number): string {
  const anchor = headingIndex === undefined ? undefined : anchors[headingIndex];
  return anchor === undefined ? url : `${url}#${encodeURIComponent(anchor)}`;
}

function isLocalImageReference(value: string): boolean {
  if (!isAllowedPreviewUrl(value) || value.startsWith('//') || value.startsWith('#') || value.startsWith('?')) {
    return false;
  }
  return URL_SCHEME.exec(value) === null;
}

export function clearHtmlPreview(frame: HTMLIFrameElement): void {
  frame.removeAttribute('src');
  frame.srcdoc = '';
}
