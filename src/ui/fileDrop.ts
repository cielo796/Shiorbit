import { dirname } from '../core/vault/path';
import type { VPath } from '../core/vault/types';

export type FileDropHandler = (dir: VPath, transfer: DataTransfer) => void;
export type FileMoveHandler = (from: VPath, dir: VPath) => void;
export interface DropTarget { path: VPath; element: HTMLElement }

/** OS からのファイル取込と、ツリー内の移動を区別するための専用形式。 */
export const INTERNAL_FILE_MIME = 'application/x-shiorbit-vpath';

export function isFileDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

export function isInternalFileDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes(INTERNAL_FILE_MIME);
}

/** ツリーのファイル行から始まったドラッグに、Vault 内パスを載せる。 */
export function markInternalFileDrag(event: DragEvent, path: VPath): boolean {
  if (!event.dataTransfer) return false;
  event.dataTransfer.setData(INTERNAL_FILE_MIME, path);
  event.dataTransfer.effectAllowed = 'move';
  return true;
}

/** DOM の差し替え後も使えるよう、ドロップ先はイベントごとに解決する。 */
export function bindFileDrop(
  host: HTMLElement,
  onDrop: FileDropHandler,
  resolve: (target: EventTarget | null) => DropTarget | null = () => ({ path: '', element: host }),
): void {
  let highlighted: HTMLElement | null = null;
  const clear = (): void => {
    highlighted?.classList.remove('file-drop-active');
    highlighted = null;
  };
  const over = (event: DragEvent): void => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const target = resolve(event.target);
    if (highlighted !== target?.element) clear();
    highlighted = target?.element ?? null;
    highlighted?.classList.add('file-drop-active');
    if (event.dataTransfer) event.dataTransfer.dropEffect = target ? 'copy' : 'none';
  };
  host.addEventListener('dragenter', over);
  host.addEventListener('dragover', over);
  host.addEventListener('dragleave', (event) => {
    if (!(event.relatedTarget instanceof Node) || !host.contains(event.relatedTarget)) clear();
  });
  host.addEventListener('dragend', clear);
  host.addEventListener('drop', (event) => {
    clear();
    if (!isFileDrag(event) || !event.dataTransfer) return;
    event.preventDefault();
    event.stopPropagation();
    const target = resolve(event.target);
    if (target) onDrop(target.path, event.dataTransfer);
  });
}

/**
 * ツリー内の既存ファイルを別フォルダへ移すドロップを処理する。
 * 外部ファイルは Files、内部移動は専用 MIME なので同じホストに共存できる。
 */
export function bindInternalFileMove(
  host: HTMLElement,
  onMove: FileMoveHandler,
  resolve: (target: EventTarget | null) => DropTarget | null,
): void {
  let highlighted: HTMLElement | null = null;
  const clear = (): void => {
    highlighted?.classList.remove('file-move-active');
    highlighted = null;
  };
  const over = (event: DragEvent): void => {
    if (!isInternalFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const target = resolve(event.target);
    if (highlighted !== target?.element) clear();
    highlighted = target?.element ?? null;
    highlighted?.classList.add('file-move-active');
    if (event.dataTransfer) event.dataTransfer.dropEffect = target ? 'move' : 'none';
  };
  host.addEventListener('dragenter', over);
  host.addEventListener('dragover', over);
  host.addEventListener('dragleave', (event) => {
    if (!(event.relatedTarget instanceof Node) || !host.contains(event.relatedTarget)) clear();
  });
  host.addEventListener('dragend', clear);
  host.addEventListener('drop', (event) => {
    clear();
    if (!isInternalFileDrag(event) || !event.dataTransfer) return;
    event.preventDefault();
    event.stopPropagation();
    const target = resolve(event.target);
    const from = event.dataTransfer.getData(INTERNAL_FILE_MIME);
    if (target && from !== '' && dirname(from) !== target.path) onMove(from, target.path);
  });
}
