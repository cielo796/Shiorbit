# Shiorbit コード規約

このプロジェクトで守っているルール。設計の全体像は [DESIGN.md](./DESIGN.md)、
使い方とビルド手順は [README.md](./README.md) を参照。

**この文書のルールは、大半が `npm run check` で機械的に検査されます。**
守れているかを人間の記憶に頼らない、というのがこの規約の基本方針です。

---

## 0. 大原則（迷ったらここへ戻る）

1. **ノートの実体は普通の `.md` ファイル。** アプリを捨てても資産が残ることを最優先する。
2. **プラットフォーム固有のコードは `src/adapters/` の中だけ。** ここが崩れると全部が崩れる。
3. **データを黙って捨てない。** 失われる側は必ずファイルとして残す。

---

## 1. レイヤと依存の向き

```
src/ui/     →  src/core/  →  src/core/vault/VaultAdapter (interface)
                                      ↑
src/main.ts →  src/adapters/ ─────────┘
```

| ディレクトリ | 役割 | 知ってよいこと |
|---|---|---|
| `src/core/` | ドメインロジック | 純粋な TypeScript のみ。`window` も `document` も `fs` も知らない |
| `src/ui/` | 画面 | DOM と `src/core/`。**`src/adapters/` は import しない** |
| `src/adapters/` | プラットフォーム実装 | 何でも触ってよい唯一の場所 |
| `src/main.ts` | 合成ルート | `src/adapters/` を import してよい唯一のファイル |

**逆向きの依存は禁止。** `src/core/` が `src/ui/` を参照することはない。

> **なぜ:** `src/core/` がブラウザを知らないおかげで、テストがブラウザなしで走り、
> Phase 4 のモバイル対応で `src/core/` の変更が 0 行で済みました。

---

## 2. 境界のルール（最重要）

詳細と背景は [DESIGN.md §13](./DESIGN.md)。運用上の3ルールだけ再掲します。

### ルール1: 禁止識別子を `src/adapters/` の外に出さない

```
showDirectoryPicker / showOpenFilePicker / showSaveFilePicker
FileSystemDirectoryHandle / FileSystemFileHandle / FileSystemWritableFileStream
createWritable / navigator.storage / indexedDB
Capacitor / @capacitor/ / node:fs / require('fs') / electron
```

`npm run check:boundary` が grep して、違反をファイル名と行番号付きで落とします。
新しいプラットフォームを足したら、その固有識別子を
`scripts/check-boundary.mjs` の `FORBIDDEN` に追加してください。

### ルール2: 識別子は「ただの文字列」

```ts
openNote(handle: FileSystemFileHandle)   // ✕ 固有の型が本体へ侵入する
openNote(path: VPath)                    // ○ "AI/Ollama.md"
```

**最も頻出する漏れ方がこれです。** アダプタファイルを分けていても、
型が漏れていれば境界は破れています。ハンドルやプラグイン固有のオブジェクトは
アダプタの内部だけで解決してください。

### ルール3: 境界を跨ぐメソッドは全部 `Promise`

同期で読めると一度でも仮定すると、その前提が後で必ず詰まります。
`node:fs` には同期版がありますが、FSA にも Capacitor にもありません。**低いほうに合わせる。**

### 境界が生きているかの確認方法

```bash
npm run check:boundary   # 禁止識別子と依存方向を検査
npm test                 # MemoryAdapter でブラウザなしで通るか
```

**後者が本体の検査です。** `MemoryAdapter`（`Map` に読み書きするだけのニセ Vault）を
差し込んでコアのテストが全部通るなら、プラットフォーム依存は漏れていません。
`test/vaultService.test.ts` に `expect(typeof window).toBe('undefined')` を入れてあり、
「本当にブラウザなしで動いている」ことを毎回確認しています。

---

## 3. TypeScript

`tsconfig.json` で以下を有効にしています。**緩めないこと。**

| 設定 | 理由 |
|---|---|
| `strict` | 前提 |
| `noUnusedLocals` / `noUnusedParameters` | 消し忘れが積もると読めなくなる |
| `noImplicitOverride` | 意図しない上書きを防ぐ |
| `noFallthroughCasesInSwitch` | break 忘れ |
| `verbatimModuleSyntax` | 型のみの import を実行時に残さない |
| `isolatedModules` | Vite / esbuild の前提に合わせる |

### import は型と値を分ける

```ts
import type { VaultAdapter } from '../core/vault/VaultAdapter';   // 型だけ
import { VaultService } from '../core/vault/VaultService';        // 値
```

`verbatimModuleSyntax` が有効なので、型のみの import に `type` を付け忘れると
バンドルに不要な副作用が残ります。

### `any` は使わない

外部から来る未知の値は `unknown` で受けて、絞り込んでから使います。

```ts
function mapError(e: unknown, path: VPath): never {
  const code = (e as { code?: string } | null)?.code;
  ...
}
```

### 型定義の置き場所

- ドメインの型 → `src/core/**/types.ts`
- プラットフォーム固有の型 → そのアダプタファイルの中（**export しない**）

`src/adapters/fsa.ts` は `FileSystemDirectoryHandle` を使わず、
`FsaDir` という自前の最小インターフェースを**ファイル内に**定義しています。
`lib.dom` との衝突を避けつつ、型が外へ漏れないようにするためです。

---

## 4. エラー処理

### 境界の向こう側のエラーは必ず翻訳する

各アダプタは、プラットフォーム固有の例外を `VaultError` に変換してから外へ出します。

```ts
function mapError(e: unknown, path: VPath): never {
  if (e instanceof VaultError) throw e;
  const name = (e as { name?: string } | null)?.name;
  if (name === 'NotFoundError') throw enoent(path);
  if (name === 'NotAllowedError') throw eperm(`...`, e);
  throw new VaultError('EIO', `入出力エラー: ${path}`, e);
}
```

コード体系は POSIX に寄せています:
`ENOENT` / `EEXIST` / `EPERM` / `EISDIR` / `ENOTDIR` / `ECONFLICT` / `EIO`

> **なぜ:** UI が「ファイルが無い」を判定するのに、
> ブラウザの `NotFoundError` と Capacitor の `"File does not exist"` と
> Node の `ENOENT` を全部知っている必要はないからです。

### 握り潰してよいのは「失っても困らないもの」だけ

```ts
// ○ キャッシュは消えても全件スキャンし直せばよい
try { await this.cache.set(key, payload); } catch (e) {
  console.warn('[Indexer] キャッシュの保存に失敗しました', e);
}

// ✕ ノートの保存を握り潰すのは論外
```

### ユーザーのデータを黙って捨てない

競合したら、どちらを選んでも失われる側を `.conflict-YYYYMMDD-HHmm.md` に退避します
（`VaultService.saveConflictCopy`）。クラウド同期を使えば必ず衝突するので、
ここが雑だと一発で信頼を失います。

---

## 5. 非同期

- 境界を跨ぐ操作は全て `async` / `Promise`
- `void` で明示的に投げっぱなしにする場合は、その関数内で必ず `catch` していること

```ts
void this.saveNow();          // saveNow 内で try/catch 済み
```

- 破棄処理（`dispose` / `destroy` / `stop`）を持つクラスは、**必ず呼ぶ側を用意する**
  - `VaultService.dispose()` / `Indexer.dispose()` / `GraphView.destroy()`
  - Vault を開き直すときに前のインスタンスを片付けています

---

## 6. 命名

| 対象 | 規則 | 例 |
|---|---|---|
| ファイル（クラス中心） | PascalCase | `VaultService.ts` `GraphView.ts` |
| ファイル（関数中心） | camelCase | `buildGraph.ts` `quickSwitcher.ts` |
| 型・インターフェース | PascalCase | `NoteMeta` `VaultAdapter` |
| 関数・変数 | camelCase | `resolveLink` `baseMtime` |
| 定数 | UPPER_SNAKE | `SAVE_DEBOUNCE_MS` `CACHE_VERSION` |
| CSS クラス | kebab-case | `.backlink-context` `.md-toolbar` |

**インターフェースに `I` は付けません**（`IVaultAdapter` ではなく `VaultAdapter`）。

**Vault 相対パスの型は必ず `VPath`。** `string` と書かない。
実体は文字列ですが、「これは Vault 相対パスである」という意図を型名で伝えます。

---

## 7. コメント

**「何を」ではなく「なぜ」を書く。** コードを読めば分かることは書きません。

```ts
// ✕ 何をしているかの繰り返し
// フラグを true にする
this.suppress = true;

// ○ なぜそうするのか
// setDoc による書き換えで onChange を発火させないためのフラグ
private suppress = false;
```

特に**設計上の判断**と**踏んだ罠**は必ず残します。

```ts
// close() を忘れると書き込みが破棄される。必ず閉じる (設計書 §4)
if (writable) await writable.close().catch(() => undefined);

// フォーカスを奪うとキーボードが閉じてしまう
b.addEventListener('mousedown', (e) => e.preventDefault());

// 転送するとバッファが切り離されるので、複製を送る
const xs = positions.xs.slice();
```

設計書の該当箇所は `(設計書 §9)` のように参照します。

コメントは日本語で書きます（このプロジェクトの読み手が日本語話者のため）。

---

## 8. UI

### フレームワークを使わない

素の TypeScript + DOM API です。`src/ui/dom.ts` の小さなヘルパだけ使います。

```ts
el('div', 'pane-header', 'リンク元')     // タグ / クラス / テキスト
button('保存', 'primary', () => save())
highlight(text, terms)                   // <mark> で囲む（XSS を避けるため DOM で組む）
```

`innerHTML` は**使いません**。文字列連結で HTML を組み立てない。

### コンポーネントの形

```ts
export class SomePane {
  readonly dom: HTMLElement;              // 呼び出し側はこれを append する
  constructor(private readonly opts: SomePaneOptions) { ... }
  setSomething(data: X): void { ... }     // 外から状態を流し込む
  destroy?(): void { ... }                // 後始末が要るものだけ
}
```

**コールバックは `opts` に集約**します。UI コンポーネントが `Indexer` や
`VaultService` を直接持つことはしません（App が仲介する）。

> **なぜ:** `wikilinkExtension` は `WikilinkProvider`（`isResolved` / `follow` / `suggest`）
> しか知りません。エディタが `Indexer` を知らないので、差し替えもテストも楽になります。

### App が司令塔

`src/ui/app.ts` が全体を組み立て、各ペインへ状態を配ります。
インデックス更新は `onIndexChanged()` に集約し、そこから各ペインへ流します。

---

## 9. CSS

- **色は必ず CSS 変数経由。** 直接の色指定は `:root` の定義の中だけ。
- テーマは `:root[data-theme='light']` で変数を上書き。個別セレクタを増やさない。
- モバイルは `@media (max-width: 767px)`、中間は `768px〜1099px`。
- セーフエリアは `env(safe-area-inset-*)`、キーボードは `var(--kb-inset)`。

```css
/* ○ */  color: var(--fg-dim);
/* ✕ */  color: #8b8b93;
```

CodeMirror の見た目は `EditorView.baseTheme` の中でも CSS 変数を参照します
（テーマ切替が効くように）。

---

## 10. テスト

### 3種類あり、役割が違う

| 種類 | 場所 | 目的 |
|---|---|---|
| ユニット | `test/*.test.ts` | 純粋関数とコアのロジック |
| **アダプタ契約** | `test/adapterContract.ts` | 全アダプタが同じ約束を守っているか |
| スモーク | `test/app.smoke.test.ts` | 起動して例外で落ちないか（jsdom） |

### 環境は node が既定

`vitest.config.ts` は `environment: 'node'`。
DOM が要るファイルだけ先頭に `// @vitest-environment jsdom` を書きます。

> **なぜ:** 既定を node にしておくと、うっかりコアに DOM 依存を入れた瞬間に落ちます。

### アダプタを足したら契約テストを1行

```ts
runAdapterContract('NodeAdapter (実ファイルシステム)', {
  create: async () => createNodeAdapter(await createNodeFsBridge(), root),
  cleanup: async () => rm(root, { recursive: true, force: true }),
});
```

これだけで 15 項目の検証がかかります。**新しいアダプタは必ず登録すること。**

### テスト名は日本語で、振る舞いを書く

```ts
it('外部で変更されたファイルの上書きは ConflictError で止まる', ...)
it('ノートを作ると未解決リンクが解決済みに変わる', ...)
```

「関数名 + returns」ではなく、**何が保証されるか**を書きます。
落ちたときにログだけで何が壊れたか分かるように。

### 性能は数字で固定する

```ts
expect(ms).toBeLessThan(5000);
console.info(`  1000ノード x 200ステップ: ${ms}ms`);
```

設計書の完了条件（1000ノードで滑らかに動く）は、
テストが毎回計測して報告します。

---

## 11. 自動チェック

```bash
npm run check           # 境界 → 型 → テスト（全部）
npm run check:boundary  # 境界だけ
npm run check:types     # tsc --noEmit だけ
npm test                # テストだけ
npm run build           # check を通してから本番ビルド
```

**`npm run build` は `npm run check` を内包しています。**
検査を通らないものはビルドできません。

---

## 12. 新しい機能を足すときの手順

1. **純粋なロジックを `src/core/` に書く**（DOM もプラットフォームも触らない）
2. **テストを書く**（node 環境で通ること）
3. **UI を `src/ui/` に足す**（`src/core/` だけを参照）
4. **プラットフォーム固有の何かが要ると気づいたら、そこで止まる**
   - `src/core/` に interface を1枚足す（例: `KeyValueStore`）
   - 実装は `src/adapters/` に置く
   - `src/main.ts` から注入する
   - 禁止識別子を `scripts/check-boundary.mjs` に追加する
5. `npm run check` を通す

**4 を飛ばして UI やコアに固有コードを書き始めたら、それが境界の崩壊です。**

---

## 13. やらないこと

| 禁止 | 代わりに |
|---|---|
| `any` | `unknown` で受けて絞り込む |
| `innerHTML` / HTML 文字列連結 | `el()` と DOM API |
| 色の直接指定 | CSS 変数 |
| `src/core` `src/ui` から `src/adapters` を import | `src/main.ts` で注入 |
| プラットフォーム固有の型を export | アダプタ内に閉じる |
| ノートの保存エラーを握り潰す | ユーザーに伝える／退避する |
| 検査を緩めて通す | 検査に合わせて直す |
| 未対応の Markdown 記法を消す | **壊さず生テキストのまま残す** |

最後の一項は特に重要です。パースできない＝消す、を絶対にやらないこと。
ユーザーのノートが静かに壊れます。

---

## 14. フェーズ運用

`DESIGN.md §12` のフェーズ表を進捗の唯一の記録とします。

- フェーズを終えたら、表の「状態」列を更新する
- 完了条件を満たしたことを、**テストか実測値で示す**
- 分かった制限は README の「既知の制限」に書く（隠さない）

Phase 0 の完了チェックリスト（`DESIGN.md §13.6`）は、
新しくこのプロジェクトに触る人が最初に読むべき場所です。
