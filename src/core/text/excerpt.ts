/** 索引・UIの両方で、リンク文脈を巨大な本文にしない。 */
export const MAX_CONTEXT_LENGTH = 160;

export function limitContext(text: string): string {
  if (text.length <= MAX_CONTEXT_LENGTH) return text;
  let end = MAX_CONTEXT_LENGTH - 1;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end--;
  return `${text.slice(0, end)}…`;
}
