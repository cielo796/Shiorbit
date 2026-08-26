import { WidgetType } from '@codemirror/view';
import { el } from '../dom';

/** 埋め込みとして描けるもの。解決できないときは null を返す。 */
export type EmbedContent =
  | { kind: 'image'; url: string; alt: string }
  | { kind: 'note'; path: string; text: string };

export interface EmbedProvider {
  /**
   * `![[target#subpath]]` の中身を解決する。
   *
   * **展開は1階層まで**。ここで返すのは素のテキストで、
   * その中の `![[...]]` はさらに展開しない（循環参照で固まるため）。
   */
  resolve: (target: string, subpath?: string) => Promise<EmbedContent | null>;
  open: (target: string) => void;
}

/**
 * `![[...]]` を本文の中に描くウィジェット。
 *
 * 中身の読み込みは非同期なので、まず枠を返してから差し替える。
 * 差し替え中に別のノートへ移っても困らないよう、DOM が生きているかを見てから触る。
 */
export class EmbedWidget extends WidgetType {
  constructor(
    private readonly target: string,
    private readonly subpath: string | undefined,
    private readonly provider: EmbedProvider,
  ) {
    super();
  }

  override eq(other: EmbedWidget): boolean {
    return other.target === this.target && other.subpath === this.subpath;
  }

  override toDOM(): HTMLElement {
    const host = el('span', 'cm-embed');
    host.append(el('span', 'cm-embed-loading', this.label()));
    host.title = `${this.label()} を開く`;
    host.addEventListener('mousedown', (event) => {
      event.preventDefault();
      this.provider.open(this.target);
    });

    void this.fill(host);
    return host;
  }

  /** クリックで元ノートへ移動できるので、選択の邪魔をしないよう無視させない。 */
  override ignoreEvent(): boolean {
    return false;
  }

  private label(): string {
    return this.subpath === undefined ? this.target : `${this.target}${this.subpath}`;
  }

  private async fill(host: HTMLElement): Promise<void> {
    const content = await this.provider.resolve(this.target, this.subpath);
    if (!host.isConnected) return;

    if (content === null) {
      host.replaceChildren(el('span', 'cm-embed-missing', `${this.label()} は埋め込めません`));
      return;
    }

    if (content.kind === 'image') {
      const image = el('img', 'cm-embed-image');
      image.src = content.url;
      image.alt = content.alt;
      image.loading = 'lazy';
      host.replaceChildren(image);
      return;
    }

    const block = el('span', 'cm-embed-note');
    block.append(
      el('span', 'cm-embed-title', this.label()),
      el('span', 'cm-embed-body', content.text),
    );
    host.replaceChildren(block);
  }
}
