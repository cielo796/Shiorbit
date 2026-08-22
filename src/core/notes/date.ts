/**
 * 日付の書式化。moment.js 風の記号のうち、実用上必要な範囲だけを扱う。
 *   YYYY 年 / MM 月 / DD 日 / HH 時 / mm 分 / ss 秒 / ddd 曜日
 */
export function formatDate(date: Date, format: string): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];

  const table: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    YY: pad(date.getFullYear() % 100),
    MM: pad(date.getMonth() + 1),
    M: String(date.getMonth() + 1),
    DD: pad(date.getDate()),
    D: String(date.getDate()),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds()),
    ddd: weekdays[date.getDay()] ?? '',
  };

  return format.replace(/YYYY|YY|MM|M|DD|D|HH|mm|ss|ddd/g, (token) => table[token] ?? token);
}

/** Daily Note のパスを組み立てる */
export function dailyPath(date: Date, folder: string, format: string): string {
  const name = formatDate(date, format);
  const dir = folder.trim().replace(/^\/+|\/+$/g, '');
  return dir === '' ? `${name}.md` : `${dir}/${name}.md`;
}
