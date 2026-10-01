const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
};

/** 埋め込み表示に対応している画像かどうか。 */
export function isEmbeddableImage(path: string): boolean {
  return mimeOf(path) !== null;
}

export function mimeOf(path: string): string | null {
  const at = path.lastIndexOf('.');
  if (at < 0) return null;
  return MIME[path.slice(at).toLowerCase()] ?? null;
}

/**
 * バイナリ → ObjectURL の変換を、上限つきで覚えておく置き場。
 *
 * ObjectURL は revoke するまでメモリに残り続ける。
 * ノートを切り替えるたびに作りっぱなしにすると際限なく増えるので、
 * 使われていないものから順に revoke する（LRU）。
 */
export class AttachmentUrlCache {
  private readonly urls = new Map<string, string>();
  private readonly pending = new Map<string, Promise<string | null>>();
  private generation = 0;

  constructor(
    private readonly load: (path: string) => Promise<ArrayBuffer>,
    private readonly limit = 50,
  ) {}

  get size(): number {
    return this.urls.size;
  }

  /** 対応形式でなければ null。読めなければ例外ではなく null を返す。 */
  async get(path: string): Promise<string | null> {
    const mime = mimeOf(path);
    if (mime === null) return null;

    const cached = this.urls.get(path);
    if (cached !== undefined) {
      // 使ったものを末尾へ動かす（末尾ほど新しい）。
      this.urls.delete(path);
      this.urls.set(path, cached);
      return cached;
    }

    const inFlight = this.pending.get(path);
    if (inFlight !== undefined) return inFlight;

    const generation = this.generation;
    const request = this.loadUrl(path, mime, generation);
    this.pending.set(path, request);
    void request.finally(() => {
      if (this.pending.get(path) === request) this.pending.delete(path);
    });
    return request;
  }

  private async loadUrl(path: string, mime: string, generation: number): Promise<string | null> {
    let url: string;
    try {
      const data = await this.load(path);
      if (generation !== this.generation) return null;
      url = URL.createObjectURL(new Blob([data], { type: mime }));
    } catch {
      return null;
    }

    this.urls.set(path, url);
    this.evict();
    return url;
  }

  release(path: string): void {
    const url = this.urls.get(path);
    if (url === undefined) return;
    this.urls.delete(path);
    URL.revokeObjectURL(url);
  }

  /** Vault を閉じるときは必ず呼ぶ。残すと解放されない。 */
  clear(): void {
    this.generation++;
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.pending.clear();
  }

  private evict(): void {
    while (this.urls.size > this.limit) {
      const oldest = this.urls.keys().next();
      if (oldest.done === true) return;
      this.release(oldest.value);
    }
  }
}
