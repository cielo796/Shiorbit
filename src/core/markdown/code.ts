/**
 * コード領域のマスキング。
 *
 * ``` フェンス内・`インラインコード`内・エスケープ (\[) を、
 * 同じ長さの空白に置き換えた文字列を返す。
 *
 * オフセットが元の文字列と1対1で対応するので、
 * マスク後の文字列に正規表現をかけても位置がそのまま使える。
 */
export function maskCode(text: string): string {
  const out = text.split('');
  const n = text.length;

  const blank = (from: number, to: number): void => {
    for (let i = from; i < to && i < n; i++) {
      if (out[i] !== '\n') out[i] = ' ';
    }
  };

  // --- フェンスコードブロック (``` または ~~~)
  const fence = /^[ \t]{0,3}(`{3,}|~{3,})[^\n]*$/gm;
  let open: { start: number; marker: string } | null = null;
  for (const m of text.matchAll(fence)) {
    const start = m.index;
    const marker = m[1]!;
    if (open === null) {
      open = { start, marker: marker[0]! };
    } else if (marker[0] === open.marker) {
      // 開始フェンス行から終了フェンス行まで丸ごと消す
      blank(open.start, start + m[0].length);
      open = null;
    }
  }
  if (open !== null) blank(open.start, n); // 閉じられていないフェンス

  const masked = out.join('');

  // --- インラインコード (マスク済みテキストに対して実行)
  const inline = /(`+)(?:(?!\1)[\s\S])*?\1/g;
  const out2 = masked.split('');
  for (const m of masked.matchAll(inline)) {
    for (let i = m.index; i < m.index + m[0].length; i++) {
      if (out2[i] !== '\n') out2[i] = ' ';
    }
  }

  // --- バックスラッシュエスケープ (\[ など) を無効化
  for (let i = 0; i < out2.length - 1; i++) {
    if (out2[i] === '\\') {
      out2[i] = ' ';
      if (out2[i + 1] !== '\n') out2[i + 1] = ' ';
      i++;
    }
  }

  return out2.join('');
}
