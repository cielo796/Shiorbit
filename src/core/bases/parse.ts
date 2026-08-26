import {
  FILTER_OPS,
  emptyBase,
  type BaseColumn,
  type BaseDefinition,
  type BaseFilter,
  type BaseValue,
  type FilterOp,
} from './types';

/**
 * `.base` の読み書き。
 *
 * YAML の完全な実装は持ちません。ここで扱うのは
 * 「スカラー・入れ子のマップ・配列・マップの配列」の4つだけです。
 * 解釈できない行は捨てて、読める分だけで表を出します
 * （設定を1行間違えただけで何も見られなくなるのを避けるため）。
 */
export function parseBase(text: string): BaseDefinition {
  const root = parseYaml(text);
  const map = isMap(root) ? root : {};

  return {
    name: asString(map['name']) ?? '',
    from: parseFrom(map['from']),
    where: asArray(map['where']).map(parseFilter).filter((f): f is BaseFilter => f !== null),
    columns: asArray(map['columns']).map(parseColumn).filter((c): c is BaseColumn => c !== null),
    ...parseSort(map['sort']),
  };
}

/** 読み込んだ定義を書き戻す。往復しても意味が変わらないことをテストで固定する。 */
export function stringifyBase(base: BaseDefinition): string {
  const lines: string[] = [`name: ${scalarText(base.name)}`];

  if (base.from.folder !== undefined || base.from.tags !== undefined) {
    lines.push('from:');
    if (base.from.folder !== undefined) lines.push(`  folder: ${scalarText(base.from.folder)}`);
    if (base.from.tags !== undefined) {
      lines.push(`  tags: [${base.from.tags.map(scalarText).join(', ')}]`);
    }
  }

  if (base.where.length > 0) {
    lines.push('where:');
    for (const filter of base.where) {
      lines.push(`  - property: ${scalarText(filter.property)}`);
      lines.push(`    op: ${filter.op}`);
      if (filter.value !== undefined) lines.push(`    value: ${valueText(filter.value)}`);
    }
  }

  if (base.columns.length > 0) {
    lines.push('columns:');
    for (const column of base.columns) {
      lines.push(`  - property: ${scalarText(column.property)}`);
      if (column.label !== undefined) lines.push(`    label: ${scalarText(column.label)}`);
    }
  }

  if (base.sort) {
    lines.push('sort:');
    lines.push(`  property: ${scalarText(base.sort.property)}`);
    lines.push(`  order: ${base.sort.order}`);
  }

  return `${lines.join('\n')}\n`;
}

/** 何も書かれていない `.base` でも、名前だけ入れて開けるようにする。 */
export function defaultBase(name: string): BaseDefinition {
  return {
    ...emptyBase(name),
    columns: [{ property: 'file.name', label: '名前' }, { property: 'file.mtime', label: '更新' }],
    sort: { property: 'file.mtime', order: 'desc' },
  };
}

// ------------------------------------------------------------------ 定義の解釈

function parseFrom(node: unknown): BaseDefinition['from'] {
  if (!isMap(node)) return {};
  const folder = asString(node['folder']);
  const tags = asStringArray(node['tags']);
  return {
    ...(folder !== undefined ? { folder } : {}),
    ...(tags !== undefined ? { tags } : {}),
  };
}

function parseFilter(node: unknown): BaseFilter | null {
  if (!isMap(node)) return null;
  const property = asString(node['property']);
  if (property === undefined) return null;

  const op = asString(node['op']) ?? 'equals';
  if (!isFilterOp(op)) return null;

  const value = node['value'];
  return {
    property,
    op,
    ...(value === undefined ? {} : { value: asValue(value) }),
  };
}

function parseColumn(node: unknown): BaseColumn | null {
  if (typeof node === 'string') return node.trim() === '' ? null : { property: node.trim() };
  if (!isMap(node)) return null;
  const property = asString(node['property']);
  if (property === undefined) return null;
  const label = asString(node['label']);
  return label === undefined ? { property } : { property, label };
}

function parseSort(node: unknown): { sort?: BaseDefinition['sort'] } {
  if (!isMap(node)) return {};
  const property = asString(node['property']);
  if (property === undefined) return {};
  return { sort: { property, order: asString(node['order']) === 'desc' ? 'desc' : 'asc' } };
}

function isFilterOp(value: string): value is FilterOp {
  return (FILTER_OPS as readonly string[]).includes(value);
}

function isMap(node: unknown): node is Record<string, unknown> {
  return typeof node === 'object' && node !== null && !Array.isArray(node);
}

function asArray(node: unknown): unknown[] {
  return Array.isArray(node) ? node : [];
}

function asString(node: unknown): string | undefined {
  if (typeof node === 'string' && node.trim() !== '') return node.trim();
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  return undefined;
}

function asStringArray(node: unknown): string[] | undefined {
  if (!Array.isArray(node)) {
    const single = asString(node);
    return single === undefined ? undefined : [single];
  }
  const items = node.map(asString).filter((item): item is string => item !== undefined);
  return items.length > 0 ? items : undefined;
}

function asValue(node: unknown): BaseValue {
  if (Array.isArray(node)) {
    return node.filter(
      (item): item is string | number | boolean =>
        typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean',
    );
  }
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return node;
  return null;
}

// ------------------------------------------------------------------ YAML の最小実装

interface Line {
  indent: number;
  text: string;
}

/** インデントで入れ子を決める。タブは空白2つとして数える。 */
function parseYaml(text: string): unknown {
  const lines: Line[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const withoutTabs = raw.replace(/\t/g, '  ');
    const trimmed = withoutTabs.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    lines.push({ indent: withoutTabs.length - withoutTabs.trimStart().length, text: trimmed });
  }

  const cursor = { at: 0 };
  return lines.length === 0 ? {} : parseBlock(lines, cursor, lines[0]!.indent);
}

function parseBlock(lines: Line[], cursor: { at: number }, indent: number): unknown {
  return lines[cursor.at]?.text.startsWith('- ')
    ? parseSequence(lines, cursor, indent)
    : parseMapping(lines, cursor, indent);
}

function parseMapping(lines: Line[], cursor: { at: number }, indent: number): Record<string, unknown> {
  const map: Record<string, unknown> = {};

  while (cursor.at < lines.length) {
    const line = lines[cursor.at]!;
    if (line.indent < indent) break;
    if (line.indent > indent) {
      // 対応する鍵が無い深い行は読み飛ばす（壊れた定義でも落ちないように）。
      cursor.at++;
      continue;
    }

    const kv = /^([^:#]+):\s*(.*)$/.exec(line.text);
    if (!kv) {
      cursor.at++;
      continue;
    }

    const key = kv[1]!.trim();
    const inline = (kv[2] ?? '').trim();
    cursor.at++;

    if (inline !== '') {
      map[key] = parseScalar(inline);
      continue;
    }

    const next = lines[cursor.at];
    map[key] = next && next.indent > indent ? parseBlock(lines, cursor, next.indent) : '';
  }

  return map;
}

function parseSequence(lines: Line[], cursor: { at: number }, indent: number): unknown[] {
  const items: unknown[] = [];

  while (cursor.at < lines.length) {
    const line = lines[cursor.at]!;
    if (line.indent !== indent || !line.text.startsWith('- ')) break;

    const head = line.text.slice(2).trim();
    const kv = /^([^:#]+):\s*(.*)$/.exec(head);
    cursor.at++;

    if (!kv) {
      items.push(parseScalar(head));
      continue;
    }

    // "- property: x" は、続く深い行と合わせて1つのマップになる。
    const item: Record<string, unknown> = { [kv[1]!.trim()]: parseScalar((kv[2] ?? '').trim()) };
    const bodyIndent = indent + 2;
    while (cursor.at < lines.length && lines[cursor.at]!.indent >= bodyIndent) {
      const child = lines[cursor.at]!;
      if (child.text.startsWith('- ')) break;
      const pair = /^([^:#]+):\s*(.*)$/.exec(child.text);
      cursor.at++;
      if (pair) item[pair[1]!.trim()] = parseScalar((pair[2] ?? '').trim());
    }
    items.push(item);
  }

  return items;
}

function parseScalar(text: string): unknown {
  if (text === '') return '';
  const quoted = /^(['"])([\s\S]*)\1$/.exec(text);
  if (quoted) return quoted[2];
  if (text.startsWith('[') && text.endsWith(']')) {
    return text
      .slice(1, -1)
      .split(',')
      .map((item) => parseScalar(item.trim()))
      .filter((item) => item !== '');
  }
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null' || text === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

function scalarText(value: string): string {
  return /^[\w./ぁ-んァ-ヶ一-龠ー-]+$/u.test(value) && value.trim() === value && value !== ''
    ? value
    : JSON.stringify(value);
}

function valueText(value: BaseValue): string {
  if (Array.isArray(value)) return `[${value.map((item) => scalarText(String(item))).join(', ')}]`;
  if (value === null) return 'null';
  if (typeof value === 'string') return scalarText(value);
  return String(value);
}
