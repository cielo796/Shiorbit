export interface Command {
  id: string;
  name: string;
  /** 表示用のキー表記。実際のキーバインドは呼び出し側が持つ。 */
  hotkey?: string;
  run: () => void | Promise<void>;
  /** false を返すとパレットに出さない */
  available?: () => boolean;
}

/**
 * コマンドの一覧。
 * パレットもホットキーも「同じ1つの定義」を指すようにして、動作のズレを防ぐ。
 */
export class CommandRegistry {
  private readonly commands = new Map<string, Command>();

  register(...commands: Command[]): void {
    for (const c of commands) this.commands.set(c.id, c);
  }

  get(id: string): Command | undefined {
    return this.commands.get(id);
  }

  /** いま実行できるものだけを返す */
  list(): Command[] {
    return [...this.commands.values()].filter((c) => c.available?.() !== false);
  }

  async run(id: string): Promise<void> {
    const command = this.commands.get(id);
    if (!command || command.available?.() === false) return;
    await command.run();
  }
}
