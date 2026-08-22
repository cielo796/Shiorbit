/**
 * 合成ルート (composition root)。
 *
 * このファイルだけが src/adapters/ を import してよい。
 * 「どのプラットフォームで動いているか」を判断して実装を選び、
 * あとは VaultAdapter / KeyValueStore という約束の形にして UI へ渡すだけ。
 *
 * Phase 4 でモバイル対応を足したが、変わったのはここと src/adapters/ だけで、
 * src/core と src/ui は1行も触っていない。境界を引いた狙いはここにある（設計書 §13）。
 */
import './style.css';
import { App, type AppDeps, type VaultSource } from './ui/app';
import { createDemoAdapter } from './adapters/memory';
import { describeUnsupported, detectPlatform } from './adapters/detect';
import { forgetVault, hasSavedVault, pickVault, restoreVault } from './adapters/fsa';
import { createKeyValueStore } from './adapters/idbKv';
import { openNativeVault } from './adapters/nativeVault';
import { forgetElectronVault, pickElectronVault, restoreElectronVault } from './adapters/electron';

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app が見つかりません');

  const platform = detectPlatform();
  document.documentElement.dataset['platform'] = platform.kind;

  // --- デスクトップアプリ (Electron): フォルダを選んでもらい、次回からは自動で開く
  if (platform.kind === 'electron') {
    let restored = await restoreElectronVault();
    let cache = restored?.cache ?? null;

    const source: VaultSource = {
      supported: true,
      unsupportedReason: '',
      pick: async () => {
        const picked = await pickElectronVault();
        if (!picked) throw Object.assign(new Error('選択されませんでした'), { name: 'AbortError' });
        restored = picked;
        cache = picked.cache;
        return picked.adapter;
      },
      restore: async () => restored?.adapter ?? null,
      hasSaved: async () => restored !== null,
      forget: async () => {
        await forgetElectronVault();
        restored = null;
      },
      demo: () => createDemoAdapter(),
    };

    void new App(root, source, cache ? { cache } : {}).start();
    return;
  }

  // --- モバイルアプリ: Documents/Shiorbit を Vault として自動で開く
  if (platform.kind === 'ios' || platform.kind === 'android') {
    const native = await openNativeVault();
    if (native) {
      const source: VaultSource = {
        supported: true,
        unsupportedReason: '',
        pick: async () => native.adapter,
        restore: async () => native.adapter,
        hasSaved: async () => false,
        demo: () => createDemoAdapter(),
      };
      void new App(root, source, { cache: native.cache }).start();
      return;
    }
  }

  // --- ブラウザ: ユーザーにフォルダを選んでもらう
  const source: VaultSource = {
    supported: platform.fsa,
    unsupportedReason: describeUnsupported(platform),
    pick: () => pickVault(),
    restore: (prompt) => restoreVault({ prompt }),
    hasSaved: () => hasSavedVault(),
    forget: () => forgetVault(),
    demo: () => createDemoAdapter(),
  };

  const cache = createKeyValueStore();
  const deps: AppDeps = cache ? { cache } : {};
  void new App(root, source, deps).start();
}

void boot();
