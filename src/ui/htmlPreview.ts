const BLOCKED_ELEMENTS = 'script, iframe, frame, frameset, object, embed, base';
const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'poster', 'xlink:href']);
const BLOCKED_URL = /^(?:javascript|vbscript|data\s*:\s*text\/html)/i;

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
 * HTMLプレビュー用の防御的サニタイズ。
 * iframe sandbox でも実行を止めるが、危険な記述自体も渡さない二重防御にする。
 */
export function buildHtmlPreview(source: string, options: HtmlPreviewOptions = {}): SanitizedPreview {
  const doc = new DOMParser().parseFromString(source, 'text/html');

  for (const element of doc.querySelectorAll(BLOCKED_ELEMENTS)) element.remove();
  for (const meta of doc.querySelectorAll('meta[http-equiv]')) {
    if (meta.getAttribute('http-equiv')?.toLowerCase() === 'refresh') meta.remove();
  }

  for (const element of doc.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith('on') || (URL_ATTRIBUTES.has(name) && BLOCKED_URL.test(value))) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  const anchors = markHeadings(doc);
  applyZoom(doc, options.zoom ?? 1);
  return { html: `<!doctype html>\n${doc.documentElement.outerHTML}`, anchors };
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
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  const anchor = options.headingIndex === undefined ? undefined : anchors[options.headingIndex];
  return anchor === undefined ? url : `${url}#${encodeURIComponent(anchor)}`;
}

export function renderHtmlPreview(
  frame: HTMLIFrameElement,
  source: string,
  options: HtmlPreviewOptions = {},
): void {
  frame.removeAttribute('srcdoc');
  frame.src = createHtmlPreviewUrl(source, options);
}

export function clearHtmlPreview(frame: HTMLIFrameElement): void {
  frame.removeAttribute('src');
  frame.srcdoc = '';
}
