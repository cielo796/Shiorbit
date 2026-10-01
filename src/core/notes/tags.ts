export interface TagEdit {
  from: number;
  to: number;
  insert: string;
}

/** YAML と本文のタグ記法で安全に往復できる名前だけを UI から作る。 */
export function normalizeTag(value: string): string {
  const tag = value.trim().replace(/^#/, '');
  if (!/^[\p{L}\p{N}_][\p{L}\p{N}_/-]*$/u.test(tag)) {
    throw new Error('タグには文字・数字・_・-・/ が使えます。空白やカンマは使えません。');
  }
  return tag;
}

const SIMPLE = /^(?:#[\p{L}\p{N}_]|[\p{L}\p{N}_])[\p{L}\p{N}_/-]*$/u;
const UNSUPPORTED = 'この frontmatter のタグ形式は専用UIでは編集できません。本文の tags / tag を直接編集してください。';

function checkScalar(value: string): void {
  const quoted = /^(['"])(.*?)\1$/.exec(value);
  const inner = quoted ? quoted[2]! : value;
  if (!SIMPLE.test(inner) || (!quoted && /^(true|false|null|~|-?\d+(\.\d+)?)$/.test(inner))) {
    throw new Error(UNSUPPORTED);
  }
}

function checkValue(value: string): void {
  if (value === '') return;
  if (value.startsWith('[') && value.endsWith(']')) {
    const content = value.slice(1, -1).trim();
    if (content) for (const part of content.split(',')) checkScalar(part.trim());
  } else {
    const quoted = /^(['"])(.*?)\1$/.exec(value);
    for (const part of (quoted ? quoted[2]! : value).split(/[,\s]+/).filter(Boolean)) {
      checkScalar(quoted ? `"${part}"` : part);
    }
  }
}

/**
 * 変更範囲を frontmatter に限定する。本文・他のプロパティ・改行はそのまま残す。
 * 解釈できない YAML を推測して上書きしない。
 */
export function editManualTags(text: string, values: readonly string[]): TagEdit {
  const tags = [...new Set(values.map(normalizeTag))];
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const line = `tags: [${tags.map((tag) => JSON.stringify(tag)).join(', ')}]${eol}`;
  const opening = /^---[ \t]*\r?\n/.exec(text);
  if (!opening) {
    return { from: 0, to: 0, insert: tags.length ? `---${eol}${line}---${eol}` : '' };
  }
  const from = opening[0].length;
  const closing = /^---[ \t]*(?:\r?\n|$)/m.exec(text.slice(from));
  if (!closing) throw new Error('frontmatter の閉じる --- がありません。先に本文を修正してください。');
  const to = from + closing.index;
  const lines = text.slice(from, to).match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const kept: string[] = [];
  let tagBlock = false;
  let blockList = false;
  const seen = new Set<string>();
  for (const original of lines) {
    const raw = original.replace(/\r?\n$/, '');
    const field = /^(tags|tag)[ \t]*:[ \t]*(.*)$/.exec(raw);
    if (field) {
      if (seen.has(field[1]!)) throw new Error(UNSUPPORTED);
      seen.add(field[1]!);
      const value = field[2]!.trim();
      checkValue(value);
      tagBlock = true;
      blockList = value === '';
      continue;
    }
    if (tagBlock && (/^[ \t]/.test(raw) || /^-\s/.test(raw))) {
      if (raw.trim() === '' || raw.trimStart().startsWith('#')) {
        blockList = false;
        kept.push(original);
        continue;
      }
      const item = /^[ \t]*-[ \t]+(.+)$/.exec(raw);
      if (!blockList || !item) throw new Error(UNSUPPORTED);
      checkScalar(item[1]!.trim());
      continue;
    }
    if (raw.trim() && !raw.startsWith('#')) tagBlock = false;
    else if (tagBlock) blockList = false;
    // 引用されたキー・複雑な表現は、重複キーを作る危険があるので編集を止める。
    if (/^["'](?:tags|tag)["']\s*:/.test(raw) || /^\s*<<\s*:/.test(raw)) throw new Error(UNSUPPORTED);
    kept.push(original);
  }
  return { from, to, insert: kept.join('') + line };
}
