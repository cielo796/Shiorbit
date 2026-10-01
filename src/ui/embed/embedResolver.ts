import type { Indexer } from '../../core/index/Indexer';
import { extractSection } from '../../core/markdown/section';
import type { VaultService } from '../../core/vault/VaultService';
import { basename, dirname, normalize } from '../../core/vault/path';
import type { Entry, VPath } from '../../core/vault/types';
import { AttachmentUrlCache, isEmbeddableImage } from './attachmentUrl';
import type { EmbedContent, EmbedProvider } from './embedWidget';
import { externalImageSource, localImagePath } from './imageSource';

export interface EmbedResolverOptions {
  vault: VaultService;
  index: () => Indexer | null;
  currentPath: () => VPath | null;
  /** ノート埋め込みの抜粋の長さ。丸ごと出すと元ノートより長くなる。 */
  limit?: number;
}

/**
 * `![[...]]` と Canvas の file ノードが要る「中身」をまとめて解決する。
 *
 * **展開は1階層まで。** 返すのは素のテキストで、その中の `![[...]]` は展開しない。
 * 深く辿ると循環参照（A が B を、B が A を埋め込む）で止まらなくなるため。
 */
export class EmbedResolver implements EmbedProvider {
  private readonly urls: AttachmentUrlCache;
  /** 添付ファイルの所在。索引はドキュメントしか持たないので別に覚える。 */
  private readonly attachments = new Map<string, VPath>();

  constructor(
    private readonly opts: EmbedResolverOptions,
    private readonly open_: (target: string) => void,
  ) {
    this.urls = new AttachmentUrlCache((path) => opts.vault.readBinary(path));
  }

  open(target: string): void {
    this.open_(target);
  }

  /** ツリーの一覧から添付を拾い直す。フルパスとファイル名の両方から引けるようにする。 */
  setEntries(entries: readonly Entry[]): void {
    this.attachments.clear();
    const names = new Map<string, VPath | null>();

    for (const entry of entries) {
      if (entry.kind !== 'file' || !isEmbeddableImage(entry.path)) continue;
      this.attachments.set(entry.path.toLowerCase(), entry.path);
      const name = basename(entry.path).toLowerCase();
      names.set(name, names.has(name) ? null : entry.path);
    }

    // 同名が複数あるものは、どれを指すか決められないので登録しない。
    for (const [name, path] of names) {
      if (path !== null && !this.attachments.has(name)) this.attachments.set(name, path);
    }
  }

  async resolve(target: string, subpath?: string, fromPath = this.opts.currentPath() ?? ''): Promise<EmbedContent | null> {
    if (isEmbeddableImage(target)) {
      const path = this.findAttachment(target, fromPath);
      if (path === null) return null;
      const url = await this.urls.get(path);
      return url === null ? null : { kind: 'image', url, alt: basename(path) };
    }

    const path = this.opts.index()?.resolve(target, fromPath) ?? null;
    if (path === null) return null;
    const text = await this.readSection(target, subpath, this.opts.limit ?? 1200, fromPath);
    return text === null ? null : { kind: 'note', path, text };
  }

  /** 通常の ![説明](URL)。Wiki画像と違い、別フォルダの同名画像には補完しない。 */
  async resolveImage(target: string, fromPath: VPath): Promise<string | null> {
    const external = externalImageSource(target);
    if (external !== null) return external;
    const path = localImagePath(target, fromPath);
    if (path === null || !isEmbeddableImage(path)) return null;
    const actual = this.attachments.get(path.toLowerCase());
    return actual === undefined || actual.toLowerCase() !== path.toLowerCase() ? null : this.urls.get(actual);
  }

  /** ノートの本文（または節）の抜粋。Canvas の file ノードもこれを使う。 */
  async readSection(target: string, subpath?: string, limit = this.opts.limit ?? 1200,
    fromPath = this.opts.currentPath() ?? ''): Promise<string | null> {
    const path = this.opts.index()?.resolve(target, fromPath) ?? null;
    if (path === null) return null;

    try {
      const note = await this.opts.vault.readNote(path);
      const text = subpath === undefined ? note.text : extractSection(note.text, subpath);
      return text === null ? null : clip(text, limit);
    } catch {
      return null;
    }
  }

  /** 開いているノートからの相対 → Vault ルート → ファイル名、の順に探す。 */
  private findAttachment(target: string, fromPath: VPath): VPath | null {
    const dir = dirname(fromPath);
    const candidates = [
      dir === '' ? '' : normalize(`${dir}/${target}`),
      normalize(target),
      basename(target),
    ];

    for (const candidate of candidates) {
      if (candidate === '') continue;
      const found = this.attachments.get(candidate.toLowerCase());
      if (found !== undefined) return found;
    }
    return null;
  }

  /** Vault を閉じるときは必ず呼ぶ。ObjectURL が残ると解放されない。 */
  dispose(): void {
    this.urls.clear();
    this.attachments.clear();
  }
}

function clip(text: string, limit: number): string {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}…`;
}
