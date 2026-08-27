import type { VaultAdapter } from '../core/vault/VaultAdapter';
import { button, el } from './dom';

export interface WelcomeOptions {
  supported: boolean;
  unsupportedReason: string;
  pick: () => Promise<VaultAdapter>;
  restore: (prompt: boolean) => Promise<VaultAdapter | null>;
  hasSaved: () => Promise<boolean>;
  demo: () => Promise<VaultAdapter>;
  onOpen: (adapter: VaultAdapter) => Promise<void>;
  toast: (message: string, isError?: boolean) => void;
}

/**
 * 起動直後の画面。
 *
 * まだ Vault が無いので、ここだけは App の状態をほとんど使わない。
 * 「フォルダを選ぶ」以外の導線（前回のフォルダ・デモ）もここにまとめる。
 */
export function renderWelcome(opts: WelcomeOptions, busy?: string): HTMLElement {
  const wrap = el('div', 'welcome');

  const heading = el('h1');
  heading.append('Shior', el('span', undefined, 'bit'));
  wrap.append(heading);

  if (busy !== undefined) {
    wrap.append(el('p', undefined, busy));
    return wrap;
  }

  wrap.append(opts.supported ? supportedBody(opts) : demoBody(opts));
  wrap.append(
    el('div', 'note',
      'Live Preview / タグ / Daily Notes / テンプレート / 埋め込み / Bases / Canvas / ' +
      'コマンドパレット（Ctrl+Shift+P）。'),
  );
  return wrap;
}

function supportedBody(opts: WelcomeOptions): DocumentFragment {
  const frag = document.createDocumentFragment();
  frag.append(
    el('p', undefined,
      'フォルダを選ぶと、その中の .md / .html / .htm ファイルをそのまま編集できます。' +
      'ファイルは通常形式のままなので、いつでも他のアプリで開けます。'),
  );

  const row = el('div', 'row');
  row.append(
    button('フォルダを開く', 'primary', () => {
      void (async () => {
        try {
          await opts.onOpen(await opts.pick());
        } catch (e) {
          // 選択のキャンセルはエラーとして見せない。
          if ((e as { name?: string })?.name === 'AbortError') return;
          opts.toast(message(e), true);
        }
      })();
    }),
  );

  // 記憶しているフォルダがあるかは非同期に分かるので、あとから足す。
  void opts.hasSaved().then((has) => {
    if (!has) return;
    row.append(
      button('前回のフォルダを開く', undefined, () => {
        void (async () => {
          try {
            const restored = await opts.restore(true);
            if (restored) await opts.onOpen(restored);
            else opts.toast('アクセスを許可できませんでした。', true);
          } catch (e) {
            opts.toast(message(e), true);
          }
        })();
      }),
    );
  });

  frag.append(row);
  return frag;
}

function demoBody(opts: WelcomeOptions): DocumentFragment {
  const frag = document.createDocumentFragment();
  frag.append(el('p', undefined, opts.unsupportedReason));

  const row = el('div', 'row');
  row.append(button('デモモードで見る', 'primary', () => {
    void (async () => {
      try {
        await opts.onOpen(await opts.demo());
      } catch (e) {
        opts.toast(message(e), true);
      }
    })();
  }));
  frag.append(row);
  return frag;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
