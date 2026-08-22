const BLOCKED_ELEMENTS = 'script, iframe, frame, frameset, object, embed, base';
const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'poster', 'xlink:href']);
const BLOCKED_URL = /^(?:javascript|vbscript|data\s*:\s*text\/html)/i;

/**
 * HTMLプレビュー用の防御的サニタイズ。
 * iframe sandbox でも実行を止めるが、危険な記述自体も渡さない二重防御にする。
 */
export function sanitizeHtmlPreview(source: string): string {
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

  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
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
export function createHtmlPreviewUrl(source: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(sanitizeHtmlPreview(source))}`;
}

export function renderHtmlPreview(frame: HTMLIFrameElement, source: string): void {
  frame.removeAttribute('srcdoc');
  frame.src = createHtmlPreviewUrl(source);
}

export function clearHtmlPreview(frame: HTMLIFrameElement): void {
  frame.removeAttribute('src');
  frame.srcdoc = '';
}
