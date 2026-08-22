import type { CommandRegistry } from '../core/commands/CommandRegistry';
import { ModalList } from './modalList';

/**
 * Ctrl+Shift+P で開くコマンド一覧。
 * ホットキーとパレットが同じ CommandRegistry を参照するので、動作がズレない。
 */
export class CommandPalette {
  private readonly modal: ModalList;

  constructor(registry: CommandRegistry) {
    this.modal = new ModalList({
      placeholder: 'コマンドを検索',
      emptyMessage: '一致するコマンドがありません',
      items: (query) => {
        const q = query.toLowerCase();
        return registry
          .list()
          .filter((c) => q === '' || c.name.toLowerCase().includes(q) || c.id.includes(q))
          .map((c) => ({
            id: c.id,
            title: c.name,
            ...(c.hotkey !== undefined ? { hint: c.hotkey } : {}),
          }));
      },
      onSelect: (item) => void registry.run(item.id),
    });
  }

  open(): void {
    this.modal.open();
  }

  get isOpen(): boolean {
    return this.modal.isOpen;
  }
}
