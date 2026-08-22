export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(
  label: string,
  className: string | undefined,
  onClick: () => void,
): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  if (className) b.className = className;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

/** 検索語に一致する部分を <mark> で囲む。XSS を避けるため DOM で組み立てる。 */
export function highlight(text: string, terms: string[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  const needles = terms.map((t) => t.toLowerCase()).filter((t) => t !== '');
  if (needles.length === 0) {
    frag.append(text);
    return frag;
  }

  const lower = text.toLowerCase();
  let i = 0;
  while (i < text.length) {
    let best = -1;
    let bestLen = 0;
    for (const needle of needles) {
      const at = lower.indexOf(needle, i);
      if (at >= 0 && (best === -1 || at < best)) {
        best = at;
        bestLen = needle.length;
      }
    }
    if (best === -1) {
      frag.append(text.slice(i));
      break;
    }
    if (best > i) frag.append(text.slice(i, best));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(best, best + bestLen);
    frag.append(mark);
    i = best + bestLen;
  }
  return frag;
}

/** 表示用にファイル名から .md を落とす */
export function noteLabel(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name;
}
