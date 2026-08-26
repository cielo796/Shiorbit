import type { NoteMeta } from '../markdown/scan';
import { basename, isAncestor, normalize } from '../vault/path';
import type { BaseDefinition, BaseFilter, BaseRow, BaseValue } from './types';

/**
 * `NoteMeta[]` から表の行を作る純粋関数。
 *
 * ファイル I/O もクエリ言語も持ちません。
 * Node のテストで全経路を確かめられるようにするためで、
 * 将来 `where` の構文を増やしても影響がここに閉じます。
 */
export function runQuery(base: BaseDefinition, notes: readonly NoteMeta[]): BaseRow[] {
  const selected = notes
    .filter((note) => inScope(base, note))
    .filter((note) => base.where.every((filter) => matches(filter, propertyOf(note, filter.property))));

  const sorted = base.sort ? sortNotes(selected, base.sort) : selected;
  return sorted.map((note) => ({
    path: note.path,
    cells: base.columns.map((column) => propertyOf(note, column.property)),
  }));
}

/** 組み込みプロパティはノート側の frontmatter より優先する。未設定は null。 */
export function propertyOf(note: NoteMeta, property: string): BaseValue {
  switch (property) {
    case 'file.name':
      return note.basename;
    case 'file.path':
      return note.path;
    case 'file.mtime':
      return note.mtime;
    case 'file.size':
      return note.size;
    case 'file.tags':
      return note.tags;
    default:
      return normalizeValue(note.frontmatter[property]);
  }
}

/** frontmatter は何でも入りうるので、表に出せる形だけを通す。 */
function normalizeValue(value: unknown): BaseValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
        ? item
        : String(item),
    );
  }
  return String(value);
}

function inScope(base: BaseDefinition, note: NoteMeta): boolean {
  const folder = base.from.folder;
  if (folder !== undefined && normalize(folder) !== '') {
    const dir = normalize(folder);
    if (!isAncestor(dir, note.path)) return false;
  }

  const tags = base.from.tags;
  if (tags && tags.length > 0) {
    const owned = new Set(note.tags.map((tag) => tag.toLowerCase()));
    if (!tags.every((tag) => owned.has(tag.replace(/^#/, '').toLowerCase()))) return false;
  }

  return true;
}

function matches(filter: BaseFilter, actual: BaseValue): boolean {
  const expected = filter.value;

  switch (filter.op) {
    case 'exists':
      // value: false と書けば「持っていない行」を選べる。
      return expected === false ? isEmpty(actual) : !isEmpty(actual);
    case 'equals':
      return equals(actual, expected);
    case 'not':
      return !equals(actual, expected);
    case 'contains':
      return contains(actual, expected);
    case 'gt':
      return compare(actual, expected) > 0;
    case 'lt':
      return compare(actual, expected) < 0;
  }
}

function equals(actual: BaseValue, expected: BaseValue | undefined): boolean {
  if (Array.isArray(actual)) return actual.some((item) => sameScalar(item, expected));
  return sameScalar(actual, expected);
}

function sameScalar(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (actual === null || actual === undefined || expected === null || expected === undefined) {
    return false;
  }
  return String(actual).toLowerCase() === String(expected).toLowerCase();
}

function contains(actual: BaseValue, expected: BaseValue | undefined): boolean {
  if (expected === undefined || expected === null) return false;
  const needle = String(expected).toLowerCase();
  if (Array.isArray(actual)) return actual.some((item) => String(item).toLowerCase().includes(needle));
  if (isEmpty(actual)) return false;
  return String(actual).toLowerCase().includes(needle);
}

/** 数字どうしは数として、それ以外は文字列として比べる。 */
function compare(actual: BaseValue, expected: BaseValue | undefined): number {
  if (isEmpty(actual) || expected === undefined || expected === null) return 0;
  const a = Array.isArray(actual) ? actual.join(',') : actual;
  if (typeof a === 'number' && typeof expected === 'number') return a - expected;

  const left = Number(a);
  const right = Number(expected);
  if (!Number.isNaN(left) && !Number.isNaN(right)) return left - right;
  return String(a).localeCompare(String(expected), 'ja', { numeric: true });
}

function sortNotes(notes: readonly NoteMeta[], sort: NonNullable<BaseDefinition['sort']>): NoteMeta[] {
  const direction = sort.order === 'desc' ? -1 : 1;
  return [...notes].sort((a, b) => {
    const left = propertyOf(a, sort.property);
    const right = propertyOf(b, sort.property);

    // 値の無い行は、昇順でも降順でも最後に置く。
    if (isEmpty(left) !== isEmpty(right)) return isEmpty(left) ? 1 : -1;
    if (isEmpty(left)) return a.path.localeCompare(b.path, 'ja');

    const order = compareValues(left, right);
    return order === 0 ? a.path.localeCompare(b.path, 'ja') : order * direction;
  });
}

function compareValues(left: BaseValue, right: BaseValue): number {
  const a = Array.isArray(left) ? left.join(',') : left;
  const b = Array.isArray(right) ? right.join(',') : right;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'ja', { numeric: true });
}

export function isEmpty(value: BaseValue): boolean {
  if (value === null || value === undefined || value === '') return true;
  return Array.isArray(value) && value.length === 0;
}

/** 表示用の文字列。日時だけは読める形にする。 */
export function formatValue(property: string, value: BaseValue): string {
  if (isEmpty(value)) return '';
  if (property === 'file.mtime' && typeof value === 'number') {
    return new Date(value).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' });
  }
  if (property === 'file.size' && typeof value === 'number') {
    return value < 1024 ? `${value} B` : `${Math.round(value / 1024)} KB`;
  }
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

/** ラベル未指定の列は、組み込みなら読みやすい名前にする。 */
export function columnLabel(property: string, label?: string): string {
  if (label !== undefined && label !== '') return label;
  switch (property) {
    case 'file.name':
      return '名前';
    case 'file.path':
      return 'パス';
    case 'file.mtime':
      return '更新';
    case 'file.size':
      return 'サイズ';
    case 'file.tags':
      return 'タグ';
    default:
      return property;
  }
}

/** 行から表示用のノート名を作る。 */
export function rowLabel(row: BaseRow): string {
  return basename(row.path, true);
}
