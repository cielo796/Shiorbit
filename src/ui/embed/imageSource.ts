/** スクリプト等を含むSVG/HTMLのdata URLは許可しない。 */
export function isRasterDataImage(value: string): boolean {
  const prefix = /^data:image\/(?:png|jpeg|gif|webp|avif|bmp);base64,/i.exec(value);
  if (!prefix) return false;
  const payload = value.slice(prefix[0].length);
  return payload.length > 0 && payload.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(payload);
}

/** 本文の外部画像はHTTPSか、埋め込み済みのラスター画像のみ。 */
export function externalImageSource(value: string): string | null {
  if (isRasterDataImage(value)) return value;
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** Vault外は読まない。URLエンコード、日本語・空白、親フォルダへの相対参照を扱う。 */
export function localImagePath(value: string, fromPath: string): string | null {
  let path: string;
  try { path = decodeURIComponent(value.split(/[?#]/, 1)[0]!); } catch { return null; }
  if (!path || /[\\:\u0000-\u001f\u007f]/.test(path)) return null;
  const parts = path.startsWith('/') ? [] : fromPath.split('/').slice(0, -1);
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/') || null;
}
