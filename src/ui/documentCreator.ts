import type { Indexer } from '../core/index/Indexer';
import { dailyPath } from '../core/notes/date';
import { newDocumentBody, resolveNewDocument } from '../core/notes/newDocument';
import type { NewDocumentKind } from '../core/notes/newDocument';
import { applyTemplate } from '../core/notes/template';
import type { SettingsData } from '../core/settings/Settings';
import { basename, dirname } from '../core/vault/path';
import type { VaultService } from '../core/vault/VaultService';
import type { VPath } from '../core/vault/types';
import { ModalList } from './modalList';
import { askNewDocument } from './newDocumentDialog';
import { noteLabel } from './dom';
import type { MarkdownEditor } from './editor';

export interface DocumentCreatorOptions {
  vault: () => VaultService | null;
  index: () => Indexer | null;
  settings: () => SettingsData | null;
  editor: () => MarkdownEditor | null;
  currentPath: () => VPath | null;
  refreshTree: () => Promise<void>;
  open: (path: VPath) => Promise<void>;
  onCreated?: (path: VPath) => void;
  toast: (message: string, isError?: boolean) => void;
}

/**
 * ノートを作る手順をまとめる。
 *
 * 「作る → ツリーを更新 → 索引へ入れる → 開く」の順番はどれも同じで、
 * 抜けると新しいノートがリンク解決に載らない。1か所に置いて揃える。
 */
export class DocumentCreator {
  constructor(private readonly opts: DocumentCreatorOptions) {}

  /**
   * 名前からノートを作る。
   * フォルダ指定が無ければ、いま開いているノートと同じフォルダに置く
   * （リンク解決が「近いものを優先」なので、関連ノートが自然にまとまる）。
   */
  async fromName(name: string, body?: string): Promise<void> {
    const vault = this.opts.vault();
    if (!vault) return;

    const trimmed = name.trim();
    if (trimmed === '') return;

    const current = this.opts.currentPath();
    const dir = current ? dirname(current) : '';
    const requested = trimmed.includes('/') || dir === '' ? trimmed : `${dir}/${trimmed}`;
    const plan = resolveNewDocument(requested, 'markdown');
    if (plan === null || (plan.kind !== 'markdown' && plan.kind !== 'html')) return;
    const path = plan.path;

    try {
      if (await vault.exists(path)) {
        await this.opts.open(path);
        return;
      }
      await vault.createNote(path, body ?? newDocumentBody(plan.kind, basename(path, true)));
      await this.publish(path);
      this.opts.toast(`${path} を作成しました。`);
    } catch (e) {
      this.opts.toast(message(e), true);
    }
  }

  /** 種別（Markdown / HTML / Base / Canvas / フォルダ）を選んで作る。 */
  async fromDialog(baseDir?: VPath, defaultKind?: NewDocumentKind): Promise<void> {
    const vault = this.opts.vault();
    if (!vault) return;

    const current = this.opts.currentPath();
    const dir = baseDir ?? (current ? dirname(current) : '');
    const plan = await askNewDocument({ baseDir: dir, defaultKind });
    if (plan === null) return;

    try {
      if (plan.kind === 'folder') {
        await vault.mkdir(plan.path);
        await this.opts.refreshTree();
        this.opts.toast(`${plan.path} を作成しました。`);
        return;
      }

      if (await vault.exists(plan.path)) {
        this.opts.toast(`${plan.path} は既にあります。`, true);
        await this.opts.open(plan.path);
        return;
      }

      await vault.createNote(plan.path, newDocumentBody(plan.kind, basename(plan.path, true)));
      await this.publish(plan.path);
      this.opts.toast(`${plan.path} を作成しました。`);
    } catch (e) {
      this.opts.toast(message(e), true);
    }
  }

  /** 今日の Daily Note。無ければテンプレートから作る。 */
  async openDaily(): Promise<void> {
    const vault = this.opts.vault();
    const settings = this.opts.settings();
    if (!vault || !settings) return;

    const { dailyFolder, dailyFormat, dailyTemplate } = settings;
    const path = dailyPath(new Date(), dailyFolder, dailyFormat);

    try {
      if (await vault.exists(path)) {
        await this.opts.open(path);
        return;
      }

      const title = basename(path, true);
      let body = `# ${title}\n\n`;
      if (dailyTemplate.trim() !== '') {
        try {
          body = applyTemplate((await vault.readNote(dailyTemplate)).text, { title });
        } catch {
          this.opts.toast(`テンプレート ${dailyTemplate} が読めませんでした。既定の内容で作ります。`, true);
        }
      }

      await vault.createNote(path, body);
      await this.publish(path);
    } catch (e) {
      this.opts.toast(message(e), true);
    }
  }

  /** テンプレートフォルダの中身を選んでカーソル位置に挿入する。 */
  insertTemplate(): void {
    const vault = this.opts.vault();
    const settings = this.opts.settings();
    const current = this.opts.currentPath();
    if (!vault || !settings || !this.opts.editor() || !current) return;

    const folder = settings.templateFolder.trim();
    void (async () => {
      let files: VPath[] = [];
      try {
        files = (await vault.listNotes())
          .map((entry) => entry.path)
          .filter((path) => folder === '' || path === folder || path.startsWith(`${folder}/`));
      } catch {
        files = [];
      }

      if (files.length === 0) {
        this.opts.toast(`テンプレートが見つかりません（${folder || 'ルート'} に .md を置いてください）。`, true);
        return;
      }

      new ModalList({
        placeholder: 'テンプレートを選ぶ',
        items: (query) =>
          files
            .filter((path) => query === '' || path.toLowerCase().includes(query.toLowerCase()))
            .map((path) => ({ id: path, title: noteLabel(path), subtitle: path })),
        onSelect: (item) => {
          void (async () => {
            try {
              const text = (await vault.readNote(item.id)).text;
              this.opts.editor()?.insertAtCursor(applyTemplate(text, { title: basename(current, true) }));
            } catch (e) {
              this.opts.toast(message(e), true);
            }
          })();
        },
      }).open();
    })();
  }

  /** 作った直後にツリー・索引へ載せてから開く。順番を間違えるとリンクが解決しない。 */
  private async publish(path: VPath): Promise<void> {
    await this.opts.refreshTree();
    await this.opts.index()?.updateNote(path);
    await this.opts.open(path);
    this.opts.onCreated?.(path);
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
