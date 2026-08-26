import type { VPath } from '../vault/types';

/** 比較のしかた。値が無い行を落とすかどうかまで含めて、ここで決まる。 */
export type FilterOp = 'equals' | 'not' | 'contains' | 'exists' | 'gt' | 'lt';

export const FILTER_OPS: readonly FilterOp[] = ['equals', 'not', 'contains', 'exists', 'gt', 'lt'];

export interface BaseFilter {
  property: string;
  op: FilterOp;
  value?: BaseValue;
}

export interface BaseColumn {
  property: string;
  /** 見出しに出す名前。省略すると property をそのまま出す。 */
  label?: string;
}

export interface BaseSort {
  property: string;
  order: 'asc' | 'desc';
}

export interface BaseFrom {
  /** 省略で Vault 全体 */
  folder?: string;
  /** すべて持っているノートだけを対象にする */
  tags?: string[];
}

export interface BaseDefinition {
  name: string;
  from: BaseFrom;
  where: BaseFilter[];
  columns: BaseColumn[];
  sort?: BaseSort;
}

/** frontmatter から出てくる値と、組み込みプロパティの値。 */
export type BaseValue = string | number | boolean | null | readonly (string | number | boolean)[];

export interface BaseRow {
  path: VPath;
  /** columns と同じ並びの値。未設定は null。 */
  cells: BaseValue[];
}

/** 表に出せる組み込みプロパティ。ノート側の frontmatter より優先する。 */
export const BUILTIN_PROPERTIES = [
  'file.name',
  'file.path',
  'file.mtime',
  'file.size',
  'file.tags',
] as const;

export function emptyBase(name = ''): BaseDefinition {
  return { name, from: {}, where: [], columns: [] };
}
