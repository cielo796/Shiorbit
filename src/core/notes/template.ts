import { formatDate } from './date';

export interface TemplateContext {
  title: string;
  date?: Date;
}

/**
 * テンプレート変数の展開。
 *   {{title}}  ノート名
 *   {{date}}   YYYY-MM-DD
 *   {{time}}   HH:mm
 *   {{date:YYYY年M月D日(ddd)}}  書式を指定した日付
 */
export function applyTemplate(text: string, ctx: TemplateContext): string {
  const date = ctx.date ?? new Date();
  return text.replace(/\{\{\s*([a-zA-Z]+)(?::([^}]*))?\s*\}\}/g, (whole, name: string, arg?: string) => {
    switch (name.toLowerCase()) {
      case 'title':
        return ctx.title;
      case 'date':
        return formatDate(date, arg && arg.trim() !== '' ? arg : 'YYYY-MM-DD');
      case 'time':
        return formatDate(date, arg && arg.trim() !== '' ? arg : 'HH:mm');
      default:
        return whole; // 知らない変数はそのまま残す
    }
  });
}
