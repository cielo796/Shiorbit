import { isHtml } from '../vault/path';

/** 検索索引には本文を渡し、画像のバイナリ表現やHTMLのCSS/スクリプトは渡さない。 */
export function searchText(path: string, source: string): string {
  if (!isHtml(path)) {
    return source.replace(/data:[^\s,<>()[\]]*;base64,[A-Za-z0-9+/=_-]+/gi, ' ');
  }
  const parts: string[] = [];
  let position = 0;
  while (position < source.length) {
    const start = source.indexOf('<', position);
    if (start < 0) { parts.push(source.slice(position)); break; }
    parts.push(source.slice(position, start));
    if (source.startsWith('<!--', start)) {
      const close = source.indexOf('-->', start + 4);
      position = close < 0 ? source.length : close + 3;
      continue;
    }
    const tag = /^<\/?([a-z][\w:-]*)\b/i.exec(source.slice(start, start + 128));
    if (!tag && !/^<[!?]/.test(source.slice(start, start + 2))) {
      parts.push('<'); position = start + 1; continue;
    }
    let end = start + 1;
    let quote = '';
    // 属性値内の > で切らず、不正な巨大タグでも先頭からやり直さない（線形時間）。
    for (; end < source.length; end++) {
      const char = source[end]!;
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    position = Math.min(end + 1, source.length);
    parts.push(' ');
    if (tag && source[start + 1] !== '/' && /^(?:script|style|template|noscript)$/i.test(tag[1]!)) {
      const close = new RegExp(`</${tag[1]}\\s*>`, 'gi');
      close.lastIndex = position;
      const found = close.exec(source);
      position = found ? found.index + found[0].length : source.length;
    }
  }
  return parts.join('').replace(/&(?:nbsp|amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, entity => {
    const named: Record<string, string> = {
      '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
    };
    const found = named[entity.toLowerCase()];
    if (found !== undefined) return found;
    const hex = entity[2]?.toLowerCase() === 'x';
    const point = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point) : '\ufffd';
  });
}
