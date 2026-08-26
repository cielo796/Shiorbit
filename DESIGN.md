# Shiorbit 設計書

**HTML/Web技術によるObsidian互換ノートアプリ — PC + スマホ両対応**

> 実装時のルールは [CONVENTIONS.md](./CONVENTIONS.md)、使い方は [README.md](./README.md) を参照。

| 項目 | 内容 |
|---|---|
| プロジェクト名 | Shiorbit |
| 版 | v0.1 |
| 日付 | 2026-08-20 |
| 状態 | Phase 0〜4 実装済み（→ §12）。Phase 4 は実機検証が未了 |

---

## 1. ゴールと非ゴール

### ゴール

1. **ノートの実体は普通の `.md` ファイル**。独自DBに閉じ込めない。ユーザーがアプリを捨てても資産が残る。
2. **`[[WikiLink]]` による相互リンク**とバックリンク、グラフ可視化。
3. **PC・スマホの両方でアプリとして動く**。単一コードベース。
4. **オフライン完結**。サーバー不要（同期は外部サービスに委譲）。

### 非ゴール（v1では作らない）

- リアルタイム共同編集（Notion的な用途はNotionに任せる）
- 独自クラウド同期基盤（iCloud / Drive / Git に委譲）
- WYSIWYGリッチテキスト（あくまでMarkdownが正）

---

## 2. 最重要の制約 — これが設計全体を決める

> **File System Access API（`showDirectoryPicker`）はデスクトップのChrome / Edge / Opera でしか動かない。**
> iOS Safari は非対応、Android Chrome もローカルディスクピッカーを無効化している。
> WebKit が持つのは **OPFS（Origin Private File System）** だけで、これは「ユーザーから見える端末フォルダ」ではない。

つまり「FSA APIで実フォルダを読み書きする」方針と「スマホでもアプリ化する」方針は、**ブラウザだけでは両立しない**。

**解決策：ストレージを抽象化し、プラットフォームごとに実装を差し替える。**
アプリの99%のコードはプラットフォームを知らない。差分は `VaultAdapter` の実装1ファイルだけに閉じ込める。

### プラットフォーム対応マトリクス

| 実行形態 | 配布 | ストレージ実装 | 実フォルダ | 外部変更検知 |
|---|---|---|---|---|
| **PC ブラウザ**（Chrome / Edge） | PWA | File System Access API | ◎ 任意フォルダ | △ ポーリング |
| **PC アプリ**（Win/mac/Linux） | Capacitor Electron | Node `fs` | ◎ 任意フォルダ | ◎ `fs.watch` |
| **iOS アプリ** | Capacitor 8 → App Store / TestFlight | `@capacitor/filesystem`（Documents） | ◎ Filesアプリに公開 | ○ |
| **Android アプリ** | Capacitor 8 → APK / Play | `@capacitor/filesystem` + SAF | ◎ 任意フォルダ | ○ |
| **スマホ ブラウザ**（保険） | PWA | OPFS | ✕ アプリ内部のみ | ✕ |

**採用シェル：Capacitor 8**（2026年時点で最新は 8.4.x）。理由：

- iOS / Android がファーストクラス
- `@capacitor/electron`（Capawesome）でデスクトップも同じコマンド体系（`cap add` / `cap sync` / `cap run`）で出せる
- Tauri 2 は Rust製で軽量だがデスクトップ起点、モバイルは後追い。今回は**モバイル優先**なのでCapacitorを選ぶ

---

## 3. 全体アーキテクチャ

```
┌───────────────────────────────────────────────┐
│  UI層                                          │  プラットフォーム非依存
│  Explorer / Editor / Preview / Graph /         │
│  Backlinks / Search / CommandPalette           │
├───────────────────────────────────────────────┤
│  アプリケーション層（Core）                      │  プラットフォーム非依存
│  VaultService · Indexer · LinkResolver ·       │
│  SearchService · CommandRegistry · Settings    │
├───────────────────────────────────────────────┤
│  ストレージ抽象層  interface VaultAdapter       │  ← 差分はここだけ
├────────┬────────┬───────────┬─────────────────┤
│  FSA   │  OPFS  │ Capacitor │ Node(Electron)  │
│ PC Web │ SP Web │  iOS/AOS  │   Desktop App   │
└────────┴────────┴───────────┴─────────────────┘
```

### 依存の向き

UI → Core → VaultAdapter（interface）。逆向きの依存は禁止。
Core は `window` も `fs` も知らない。テストは in-memory アダプタで完結する。

---

## 4. ストレージ抽象層

```ts
/** Vault相対パス。例: "AI/Ollama.md" 常にスラッシュ区切り、先頭スラッシュなし */
type VPath = string;

interface VaultCapabilities {
  realFolder: boolean;   // ユーザーがOSのファイラで見られるか
  watch: boolean;        // 外部変更をpushで検知できるか
  rename: boolean;       // アトミックなrenameがあるか
  binary: boolean;       // 画像・PDF添付を扱えるか
}

interface VaultAdapter {
  readonly id: 'fsa' | 'opfs' | 'capacitor' | 'node' | 'memory';
  readonly caps: VaultCapabilities;

  /** フォルダ選択 or 前回のVaultを復元 */
  open(hint?: unknown): Promise<VaultHandle>;

  list(dir: VPath, recursive: boolean): Promise<Entry[]>;
  read(path: VPath): Promise<string>;
  readBinary(path: VPath): Promise<ArrayBuffer>;
  write(path: VPath, text: string): Promise<void>;
  writeBinary(path: VPath, buf: ArrayBuffer): Promise<void>;
  rename(from: VPath, to: VPath): Promise<void>;
  remove(path: VPath): Promise<void>;
  mkdir(path: VPath): Promise<void>;
  stat(path: VPath): Promise<{ mtime: number; size: number }>;

  /** caps.watch が false の場合は VaultService 側でポーリングに fallback */
  watch?(cb: (ev: FileEvent) => void): () => void;
}

type FileEvent =
  | { type: 'create' | 'modify' | 'delete'; path: VPath }
  | { type: 'rename'; from: VPath; to: VPath };
```

### 実装ごとの注意点

**`fsa.ts`（PC ブラウザ）**

- `showDirectoryPicker({ mode: 'readwrite' })` で `FileSystemDirectoryHandle` を取得
- **ハンドルを IndexedDB に構造化クローンで保存**すれば次回起動時に復元できる。ただし権限は失効するので `queryPermission` → `requestPermission` をユーザー操作起点で再取得する（ここは必ずボタンを踏ませる導線が要る）
- 書き込みは `createWritable()` → `write()` → `close()`。**close忘れは書き込み消失に直結**するので必ず try/finally
- watch非対応 → mtimeポーリング（フォーカス復帰時 + 5秒間隔、ノート数に応じて間引き）

**`capacitor.ts`（iOS / Android）**

- `Directory.Documents` を使う
- iOS: `Info.plist` に `UIFileSharingEnabled` と `LSSupportsOpeningDocumentsInPlace` を **両方 YES**。これでVaultがFilesアプリに現れ、iCloud Driveに置ける（＝実質の同期手段になる）
- Android: 既定はアプリ専用領域。ユーザー任意フォルダを使うなら **SAF（Storage Access Framework）**でツリーURIを取得しpersistable permissionを保持する
- 7.1.0以降はエラーコードが具体化しているので、権限拒否と存在しないパスを区別して扱う

**`opfs.ts`（スマホブラウザ・保険）**

- `navigator.storage.getDirectory()`。Safari 15.2+ / iOS 15.2+ で動く
- **実フォルダではない**ことをUIで明示し、zipエクスポート導線を必ず置く
- ストレージ退避を防ぐため `navigator.storage.persist()` を要求する

**`node.ts`（Electron）**

- `fs.promises` + `chokidar`。唯一まともなwatchが使える環境
- レンダラから直接fsは触らず、preload経由のIPCで `VaultAdapter` を実装

---

## 5. データモデル

```ts
/** ノート1件のメタ情報。本文は保持しない（遅延ロード） */
interface NoteMeta {
  path: VPath;            // "AI/Ollama.md"
  basename: string;       // "Ollama"
  mtime: number;
  size: number;
  frontmatter: Record<string, unknown>;
  headings: { level: number; text: string; offset: number }[];
  blockIds: string[];     // 末尾 ^block-id
  links: LinkRef[];       // [[x]] と [](x)
  embeds: LinkRef[];      // ![[x]]
  tags: string[];         // 本文 #tag + frontmatter tags を統合
}

interface LinkRef {
  raw: string;            // "LocalLLM#実行環境|ローカルLLM"
  target: string;         // "LocalLLM"
  subpath?: string;       // "#実行環境" / "#^abc123"
  alias?: string;         // "ローカルLLM"
  from: number; to: number; // 本文中のオフセット（リネーム時の置換に使う）
}
```

### リンク解決規則（Obsidian互換）

`[[Foo]]` を解決する順序：

1. `Foo.md` が完全一致パスとして存在 → それ
2. basename が `Foo` のノートが**ちょうど1件** → それ
3. 複数一致 → リンク元からのパス距離が最短のもの
4. どれも無い → **未解決リンク**（unresolved）。UIでは薄い色で表示し、クリックで新規作成

未解決リンクを一級市民として扱うのが重要。「まだ書いてないノート」への言及がそのまま次に書くべきもののリストになる。

### インデックス構造（メモリ常駐）

```ts
byPath:       Map<VPath, NoteMeta>
byBasename:   Map<string, VPath[]>          // リンク解決用
forwardLinks: Map<VPath, Set<VPath>>
backlinks:    Map<VPath, Set<VPath>>        // forwardLinksの逆引き（増分更新）
unresolved:   Map<string, Set<VPath>>       // 未作成ノート名 → 言及元
tagIndex:     Map<string, Set<VPath>>
searchIndex:  MiniSearch                     // 全文検索
```

### 起動時の差分インデックス（性能の要）

```
起動
 ├─ IndexedDB から前回のインデックスを復元        （〜100ms）
 ├─ Vault を再帰list → path+mtime+size のリスト   （〜200ms / 1万件）
 ├─ 差分だけ抽出（新規・mtime変化・消失）
 └─ 差分ノートのみ read + parse → インデックス更新
```

全件パースはVault初回登録時のみ。以降は変更分だけ。
**目標：1万ノートで起動〜操作可能まで1秒以内。**

パースは Web Worker に逃がす（メインスレッドのブロックを避ける）。初回インポート時は進捗バーを出す。

---

## 6. モジュール構成

```
shiorbit/
├─ index.html
├─ capacitor.config.ts
├─ vite.config.ts
├─ src/
│  ├─ main.ts
│  ├─ core/                      ← プラットフォーム非依存・テスト対象の中心
│  │  ├─ vault/
│  │  │  ├─ VaultAdapter.ts      interface定義
│  │  │  ├─ VaultService.ts      CRUD + イベントバス + ポーリングfallback
│  │  │  └─ conflict.ts          外部変更・競合の検知と退避
│  │  ├─ index/
│  │  │  ├─ Indexer.ts           差分インデックス
│  │  │  ├─ LinkGraph.ts         forward/back/unresolved
│  │  │  ├─ TagIndex.ts
│  │  │  └─ SearchService.ts     MiniSearch ラッパ
│  │  ├─ markdown/
│  │  │  ├─ parse.ts             micromark/mdast
│  │  │  ├─ wikilink.ts          [[ ]] ![[ ]] の構文拡張
│  │  │  ├─ frontmatter.ts       YAML
│  │  │  └─ render.ts            mdast → HTML（サニタイズ込み）
│  │  ├─ commands/               CommandRegistry + キーマップ
│  │  └─ settings/               設定・テーマ・ホットキー
│  ├─ adapters/
│  │  ├─ fsa.ts  opfs.ts  capacitor.ts  node.ts  memory.ts
│  │  └─ detect.ts               実行環境判定 → 最適アダプタ選択
│  ├─ ui/
│  │  ├─ shell/                  Workspace / 分割ペイン / タブ / モバイルシェル
│  │  ├─ explorer/               ファイルツリー（仮想スクロール）
│  │  ├─ editor/                 CodeMirror 6 + Live Preview
│  │  ├─ preview/                読み取り専用レンダラ
│  │  ├─ graph/                  グローバル / ローカルグラフ
│  │  ├─ backlinks/              バックリンク・未解決リンクペイン
│  │  ├─ search/                 全文検索UI
│  │  └─ palette/                コマンドパレット・クイックスイッチャ
│  └─ platform/                  capability検出 / PWA登録 / セーフエリア
└─ workers/
   ├─ indexer.worker.ts
   └─ graph.worker.ts            force-directed 計算
```

**技術スタック：Vite + TypeScript + Svelte（または素のTS + Web Components）**

React でなく Svelte を推す理由：ランタイムが軽く、モバイルWebViewでの初期描画とメモリに効く。ただしチームの慣れが優先されるべきで、React でも設計は変わらない。CodeMirror 6 はフレームワーク非依存なのでどちらでも同じ。

---

## 7. エディタ設計

**CodeMirror 6** を採用。Obsidian自身がCM6ベースであり、Live Preview（カーソル行だけ生Markdown、他は装飾表示）を実装した先行事例も複数ある。

### Live Preview の仕組み

```
ViewPlugin + Decoration
 ├─ syntaxTree を走査し、装飾すべきノードを収集
 ├─ カーソル/選択範囲と重なるノード → 装飾しない（生Markdownを見せる）
 ├─ それ以外 → Decoration.replace(WidgetType) で置換
 │   見出し・強調・リンク・[[wikilink]]・画像埋め込み・コードブロック・callout
 └─ 変更時は差分だけ再計算（全走査しない）
```

**注意点：** 先行実装では「入力が引っかかる」「選択ハイライトが崩れる」という報告がある。Widget の `eq()` を正しく実装して不要な再生成を防ぐこと、`atomicRanges` でカーソル移動を自然にすること、この2点が体感品質を左右する。

**段階的に作る。** Phase 1では Live Preview を作らず、「編集モード / プレビューモード切替」だけにする。Live Preview は難易度が高いので土台が固まってから。

### 保存戦略

- 入力停止 **500ms デバウンス** で自動保存
- ペイン離脱・アプリバックグラウンド遷移・タブ切替時は**即時保存**
- 保存前に `stat()` で mtime を確認し、**開いた時より新しければ外部変更**として扱う（§9）

### モバイル入力

- ソフトキーボード表示時の `visualViewport` 追従（iOSは特に必要）
- エディタ上部に**カスタムツールバー**（`[[`, `#`, `- [ ]`, 太字, 見出し, リンク挿入）。スマホでMarkdown記号を打つのは苦痛なので、ここの手抜きは致命的
- `env(safe-area-inset-*)` でノッチ・ホームインジケータ対応

---

## 8. 画面設計

### PC（幅 ≥ 1024px）

```
┌────────┬──────────────────────────┬────────────┐
│        │  タブバー                  │            │
│ 左     ├──────────────────────────┤ 右         │
│ サイド │                          │ サイド     │
│        │      エディタ             │            │
│ ファイル│      （分割可能）          │ バックリンク │
│ 検索   │                          │ アウトライン│
│ タグ   │                          │ ローカルグラフ│
│ グラフ │                          │            │
└────────┴──────────────────────────┴────────────┘
```

### スマホ（幅 < 768px）

```
┌──────────────────────────┐
│ ☰   ノート名         ⋯   │  ← ヘッダ
├──────────────────────────┤
│                          │
│        エディタ           │  ← 単一ペイン
│                          │
├──────────────────────────┤
│ [[  #  - [ ]  B  H  🔗   │  ← Markdownツールバー
├──────────────────────────┤
│ 📁   🔍   ⭐   🕸   ⚙    │  ← ボトムナビ
└──────────────────────────┘
```

- 左サイドバーは**スワイプで引き出すドロワー**
- バックリンクはノート下部にアコーディオンで畳んで表示（右サイドバーは無い）
- グラフは**ローカルグラフ（深さ1〜2）を既定**にする。全体グラフをスマホで出すと確実に固まる

### 共通コンポーネント

同一コンポーネントをレイアウトだけ切り替える。「PC版」「スマホ版」の2実装は作らない。CSS Container Queries + 1つの `useLayout()` フックで分岐する。

---

## 9. 同期と競合

**アプリは同期機能を持たない。** ファイルが実体なので、同期は外部に任せるのが最も堅い（Obsidianと同じ判断）。

| 環境 | 推奨同期 |
|---|---|
| PC | OneDrive / Google Drive / Dropbox / **Git** |
| iOS | Filesアプリ経由で **iCloud Drive** |
| Android | SAFでDrive / **Syncthing** |
| 開発者向け | Git + GitHub（履歴・差分が最強） |

### 競合検知フロー

```
保存しようとする
 ├─ stat(path).mtime を取得
 ├─ 開いた時点の mtime と一致？
 │   ├─ Yes → そのまま書き込み
 │   └─ No  → 外部で変更されている
 │       ├─ 自分が未編集    → 黙って再読込
 │       └─ 自分も編集済み  → 競合ダイアログ
 │            ├─ 自分を採用（相手を .conflict-YYYYMMDD-HHmm.md に退避）
 │            ├─ 相手を採用（自分の変更を破棄 / 退避）
 │            └─ 差分を表示して手動マージ
```

**データを黙って捨てない**こと。どちらを選んでも失われる側は必ず `.conflict-*.md` として残す。クラウド同期は必ず衝突するので、ここが雑だとユーザーの信頼を一発で失う。

---

## 10. 非機能要件

| 項目 | 目標 |
|---|---|
| 起動（1万ノート、差分インデックス） | < 1.0s |
| ノート切替 | < 100ms |
| 入力レイテンシ | < 16ms（1フレーム） |
| 全文検索（1万ノート） | < 200ms |
| グラフ描画（1000ノード） | 30fps以上 |
| メモリ（1万ノート） | < 300MB（本文は遅延ロード、LRUで50件キャッシュ） |
| バンドルサイズ（初期） | < 500KB gzip（グラフ・検索は動的import） |

### グラフビューの性能戦略

- ノード数 ≤ 500 → Canvas 2D + `d3-force`
- ノード数 > 500 → WebGL（PixiJS等）+ Barnes-Hut近似
- 力学計算は **`graph.worker.ts`** に隔離。メインスレッドは描画のみ
- ズームレベルに応じたラベルの間引き（LOD）
- モバイルは既定でローカルグラフ、全体グラフは明示操作でのみ

---

## 11. セキュリティ

- Markdownレンダリングは **DOMPurify** を通す。`<script>`・`javascript:` URL・`on*` 属性を除去
- 外部リンクは `rel="noopener noreferrer"`、クリック時に確認（モバイルアプリでは外部ブラウザで開く）
- **CSP**：`default-src 'self'; img-src 'self' blob: data:; script-src 'self'` 。プラグイン機構を入れる段階では別途サンドボックス設計が必要
- テレメトリなし。ネットワークアクセスなし（ユーザーが明示的に埋め込んだ画像URL等を除く）

---

## 12. 開発フェーズ

| Phase | 内容 | 完了条件 | 状態 |
|---|---|---|---|
| **0. 骨組み** | Vite+TS、`VaultAdapter` IF、`memory` + `fsa` アダプタ、ファイルツリー、素のCodeMirror、保存 | PCブラウザでフォルダを開き `.md` を編集・保存できる | **完了** |
| **1. ナレッジベース化** | Wikilinkパーサ、リンク解決、バックリンクペイン、未解決リンク、クイックスイッチャ（Ctrl+O）、全文検索 | `[[ ]]` で相互リンクを辿れる | **完了** |
| **2. 実用化** | Live Preview、タグ、Daily Notes、テンプレート、テーマ、コマンドパレット、差分インデックス永続化 | 日常の一次ノートアプリとして使える | **完了** |
| **3. グラフ** | ローカルグラフ → 全体グラフ、Worker化、フィルタ | 1000ノードで滑らかに動く | **完了**（1000ノードで1ステップ約3ms） |
| **4. アプリ化** | Capacitor導入 → iOS / Android / Electron、`capacitor.ts` `node.ts` アダプタ、モバイルUI、競合解決 | 実機のiPhoneとAndroidで同一Vaultを編集できる | **実装完了 / 実機検証は未了**（アダプタは契約テスト通過。`src/core` の変更は0行） |
| **5. 拡張** | 負債返済（アウトライン・リネーム追従・埋め込み）＋ Bases ＋ Canvas | `.base` と `.canvas` が読み書きでき、リネームでリンクが壊れない | **進行中**（アウトライン・リネーム追従・既存機能の完成・埋め込み表示が完了。次は Bases）→ [PHASE5.md](./PHASE5.md) |
| **6. 開放** | プラグインAPI、Webクリッパ | — | 未着手（セキュリティモデルの決定が先） |

> Phase 5 は当初「Bases / Canvas / プラグインAPI / Webクリッパ」の4本立てでしたが、
> プラグインAPIは公開後に締められないためセキュリティ設計を先に要すること、
> Webクリッパは別コードベースになることから、**Phase 6 として分離**しました。
> 代わりに、日常的に踏む不具合（リンクのリネーム追従など）の返済を Phase 5 に前倒ししています。
> 詳細と根拠は [PHASE5.md](./PHASE5.md) を参照。

**Phase 4 の前倒しは避ける。** ただし Phase 0 の時点で `VaultAdapter` の境界だけは正しく引いておくこと（→ §13）。これを後から入れるのは事実上の作り直しになる。

---

## 13. Phase 0 実装ガイド — `VaultAdapter` の境界

本設計で**最も重要かつ、最も取り返しがつかない**のがこの一点。実装初日に必ず読むこと。

### 13.1 何のための境界か

海外旅行用の**変換プラグ**を思い浮かべてほしい。ドライヤー本体は「日本のコンセント」も「ヨーロッパのコンセント」も知らない。国が変わったら変換プラグだけ差し替える。ドライヤーを作り直す人はいない。

`VaultAdapter` はこの変換プラグにあたる。
アプリ本体が「Chromeでのファイル保存手順」を直接知ってしまうと、iPhone対応のときに**アプリ本体を作り直す**ことになる。

### 13.2 悪い例（境界がない）

保存処理を、必要な場所にそのまま書いてしまうパターン。

```ts
// ui/editor.ts   ✕
async function saveNote(path: string, text: string) {
  const handle = await dirHandle.getFileHandle(path, { create: true });
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
}
```

一見ふつうに見えるが、これは **Chrome / Edge でしか動かないコード**。
そして同種の処理が `explorer.ts` `dailyNotes.ts` `template.ts` `attachment.ts` … と30箇所に散らばる。

Phase 4 でiPhone対応を始めた瞬間、**その30箇所を全部探して書き直す**ことになる。これが「事実上の作り直し」の正体。

### 13.3 良い例（境界がある）

まず「何ができるか」という**約束事だけ**を書く。中身は書かない。

```ts
// core/vault/VaultAdapter.ts   ← これが「境界」そのもの
export interface VaultAdapter {
  read(path: VPath): Promise<string>;
  write(path: VPath, text: string): Promise<void>;
  list(dir: VPath, recursive: boolean): Promise<Entry[]>;
  remove(path: VPath): Promise<void>;
  // 完全な定義は §4
}
```

アプリ本体はこの約束だけを使う。**どうやって保存されるかは知らない。**

```ts
// ui/editor.ts   ○
async function saveNote(vault: VaultAdapter, path: VPath, text: string) {
  await vault.write(path, text);   // これだけ
}
```

「どうやって」は専用ファイルに隔離する。

```
adapters/fsa.ts        Chrome / Edge 用の中身   ← Phase 0 で作る
adapters/memory.ts     テスト用の中身           ← Phase 0 で作る
adapters/capacitor.ts  iOS / Android 用の中身   ← Phase 4 で足すだけ
adapters/node.ts       Electron 用の中身        ← Phase 4 で足すだけ
```

Phase 4 でやることは**ファイルを1つ足すだけ**。UI もコアも1行も変わらない。

### 13.4 守るべき3つのルール

いずれも機械的にチェックできる。

**ルール1：特定の単語を `adapters/` の外に出さない**

以下の識別子が `src/adapters/` フォルダの外に1度でも出現したら、境界が漏れている。

```
showDirectoryPicker / showOpenFilePicker
FileSystemDirectoryHandle / FileSystemFileHandle / createWritable
navigator.storage.getDirectory
Capacitor / @capacitor/filesystem / Directory.Documents
require('fs') / node:fs / electron
```

CIで検出できる。lint ルールとして固定しておくのが望ましい。

```jsonc
// .eslintrc — no-restricted-globals / no-restricted-imports を
// src/adapters/** 以外に適用する
```

**ルール2：ノートの識別子は「ただの文字列」にする**

**最も頻出する漏れ方**がこれ。アダプタファイルを分けていても、型が漏れていれば境界は破れている。

```ts
openNote(handle: FileSystemFileHandle)   // ✕ Chrome専用の型が本体に侵入
openNote(path: VPath)                    // ○ "AI/Ollama.md" という文字列
```

ハンドルオブジェクトを持ち回らない。アダプタの内部だけで `VPath → ハンドル` を解決する。

**ルール3：すべて `Promise`（非同期）にする**

「ファイルは同期的に読める」と一度でも仮定すると、そこが後で必ず詰まる。
Node の `fs.readFileSync` は同期だが、FSA も Capacitor も非同期。**低いほうに合わせる。**
今は冗長に感じても、必ず `await` 前提で書くこと。

### 13.5 合格判定 — `memory.ts` をセンサーとして使う

境界が正しく引けたかは、次の一文で判定できる。

> **ブラウザなしで、コアのテストが全部通るか。**

`adapters/memory.ts` は、ファイルではなく単なる `Map` に読み書きするニセのアダプタ。

```ts
// adapters/memory.ts
export class MemoryAdapter implements VaultAdapter {
  readonly id = 'memory';
  readonly caps = { realFolder: false, watch: true, rename: true, binary: true };
  private files = new Map<VPath, string>();

  async read(p: VPath)               { return this.files.get(p) ?? throwENOENT(p); }
  async write(p: VPath, t: string)   { this.files.set(p, t); }
  async remove(p: VPath)             { this.files.delete(p); }
  async list(dir: VPath)             { /* Map のキーを前方一致で絞る */ }
}
```

これを差し込んでコアのテストが通れば合格。

```ts
// test/indexer.test.ts — ブラウザもファイルシステムも使わない
const vault = new MemoryAdapter();
await vault.write('AI/Ollama.md', '# Ollama\n[[LocalLLM]] の実行環境');
await vault.write('AI/LocalLLM.md', '# LocalLLM');

const index = await new Indexer(vault).build();
expect(index.backlinks.get('AI/LocalLLM.md')).toContain('AI/Ollama.md');
```

**ブラウザすら要らずに動くなら、iPhoneで動かすのも同じくらい簡単。**
`memory.ts` はテスト用であると同時に、**境界が壊れていないことを検知するセンサー**として機能する。CIで常時回す。

### 13.6 Phase 0 完了チェックリスト

- [ ] `core/vault/VaultAdapter.ts` に interface のみを定義した（実装コードが1行も無い）
- [ ] `adapters/fsa.ts` と `adapters/memory.ts` の2実装がある
- [ ] ルール1の禁止識別子を `src/adapters/` 外で grep して**ヒット0件**
- [ ] `FileSystemFileHandle` 等の型が `src/core/` と `src/ui/` の型シグネチャに出てこない
- [ ] `VaultAdapter` のメソッドが**全て** `Promise` を返す
- [ ] `MemoryAdapter` を差し込んだコアのテストが、ブラウザなしで通る
- [ ] PCブラウザでフォルダを開き、`.md` を編集・保存できる（Phase 0 の本来の完了条件）

上6つが埋まらないうちに Phase 1 へ進まないこと。ここだけは、あとから直すより先に引くほうが圧倒的に安い。

---

## 14. 主なリスク

| リスク | 影響 | 対策 |
|---|---|---|
| FSAのハンドル権限が起動ごとに失効 | PCブラウザ版で毎回フォルダ選択が要る | IndexedDBにハンドル保存＋起動時に「Vaultを開く」ボタン1クリックで再許可。あるいはPCはElectron版を主軸にする |
| iOS の Files / iCloud 同期が遅延・部分同期 | ノートが「消えた」ように見える | 起動時に必ず再list。ダウンロード未完了ファイルを検知して明示表示 |
| Live Preview の実装難度 | 入力の引っかかり、選択崩れ | Phase 2まで着手しない。Decorationの`eq()`と`atomicRanges`を厳密に |
| 大規模Vaultでのメモリ | モバイルWebViewが落ちる | 本文は遅延ロード＋LRU。インデックスのみ常駐。IndexedDBへ退避 |
| Android SAF の煩雑さ | 任意フォルダ選択が不安定 | v1はアプリ専用Documents固定＋エクスポートで妥協。SAFはv2 |
| Obsidian記法の互換率 | 既存Vaultが壊れて見える | 未対応記法は**壊さず生テキストで表示**する。パースできない＝消す、を絶対にしない |

---

## 15. 決めきれていない論点

1. ~~**UIフレームワーク**~~ → **決着：素のTypeScript**。Phase 0 で採用。CodeMirror がフレームワーク非依存なので不都合は出ていない。UI が複雑化した Phase 2 以降も、`src/ui/dom.ts` の小さなヘルパで足りている。
2. ~~**PCの主軸をどちらにするか**~~ → **決着：Electron を主軸**。ブラウザ版は「インストール不要のお試し」。理由は §16。
3. **プラグインAPIを入れるか** — 入れるならセキュリティモデル（iframeサンドボックス／Worker）を先に決める必要があり、コア設計に影響する。
4. **Obsidian Vault との完全互換を狙うか** — `.obsidian/` 設定の読み込みまでやるか、独立フォーマットにするか。

---

## 16. デスクトップアプリの配布形態（Windows 実測）

Phase 4 のあと、実際に Windows 11 Home へインストールして分かったこと。

### なぜ Electron を主軸にしたか

ブラウザ版（File System Access API）は、**起動のたびにフォルダの再許可が要る**。
`FileSystemDirectoryHandle` を IndexedDB に保存できても権限は失効するため、
毎回ボタンを踏ませる導線が必要になる（§4）。日常使いではこれが効いてくる。

Electron 版はこの問題が丸ごと消える。メインプロセスが `fs` を直接扱うので、
一度選んだフォルダを次回から黙って開ける。

### 実測でぶつかった2つの壁

**1. Vite の絶対パス出力と `file://`**

`vite build` の既定は `/assets/...` という絶対パス。
Electron は `file://` でページを読むため、これはディスクのルートを探しに行き、
**真っ黒な画面**になる。`vite.config.ts` に `base: './'` が必須。

```ts
export default defineConfig({
  base: './',   // Electron の file:// 対策。Web 配信でも問題なく動く
  ...
});
```

**2. Device Guard（Smart App Control）が未署名 exe を拒否する**

`electron-builder` は Electron 本体をリネームし、リソース（アイコン・バージョン情報）を
書き換えて `Shiorbit.exe` を作る。この改変で**公式の署名が外れる**ため、
Windows 11 の Device Guard がブロックする。

```
'Shiorbit.exe' は組織の Device Guard ポリシーによってブロックされました。
```

同じ理由で NSIS インストーラのビルドも `spawn UNKNOWN` で落ちる
（electron-builder が起動しようとする signtool.exe がブロックされる）。

**採った解決策：公式の署名済み `electron.exe` を一切改変せずに使う。**

```
%LOCALAPPDATA%\Programs\Shiorbit\
├─ electron.exe            ← 公式バイナリのまま（署名が生きている）
├─ *.dll, locales\ ...     ← Electron ランタイム一式
└─ resources\app\          ← Electron が自動で読み込む場所
   ├─ package.json         （main: electron/main.cjs, productName: Shiorbit）
   ├─ electron\            （main.cjs / preload.cjs）
   ├─ dist\                （vite build の出力）
   └─ build\icon.ico
```

ショートカット（スタートメニュー・デスクトップ）は `electron.exe` を指し、
アイコンだけ `icon.ico` を指定する。ウィンドウのタイトルとアイコンは
`BrowserWindow` の `title` / `icon` で、タスクバーのグループ化は
`app.setAppUserModelId('app.shiorbit')` で整える。

**トレードオフ:**

| | 署名済み electron.exe 方式 | electron-builder の NSIS |
|---|---|---|
| Device Guard | ◎ 通る | ✕ ブロックされる |
| プロセス名 | `electron.exe` のまま | `Shiorbit.exe` |
| アンインストーラ | 自前スクリプト | 標準の「アプリと機能」に載る |
| 配布 | 自分の PC 向け | 一般配布向け |

一般配布するなら、**コード署名証明書を買って `electron-builder` で署名する**のが本筋。
自己利用の範囲では上記の方式で十分実用になる。

### セキュリティ設計

レンダラからは `fs` を触らせない。

- `contextIsolation: true` / `nodeIntegration: false` / `sandbox: true`
- preload は `ipcRenderer.invoke` を転送するだけ（Node の API を再公開しない）
- **メインプロセスは、渡された全パスが Vault の中かを毎回検証する**

```js
function safePath(target) {
  const rel = path.relative(path.resolve(vaultRoot), path.resolve(target));
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Vault の外は操作できません');
  return path.resolve(target);
}
```

これを省くと、レンダラで動く任意のコードが PC 上の全ファイルを読めてしまう。

---

## 付録：想定Vault構造

```
MyVault/
├─ .shiorbit/            設定・インデックスキャッシュ（同期対象外にできる）
│  ├─ settings.json
│  └─ cache/
├─ AI/
│  ├─ OpenAI.md
│  ├─ Anthropic.md
│  └─ Ollama.md
├─ Daily/
│  └─ 2026-08-20.md
├─ Templates/
└─ attachments/
   └─ image.png
```

---

## 参考

- [File System Access API — Chrome for Developers](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
- [File System API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API)
- [File System Access API — Can I use](https://caniuse.com/native-filesystem-api)
- [Filesystem Capacitor Plugin API](https://capacitorjs.com/docs/apis/filesystem)
- [Capacitor Electron Platform — Capawesome](https://capawesome.io/docs/sdks/capacitor/electron/)
- [Atomic Editor — CodeMirror 6 Obsidian風ライブプレビュー](https://github.com/kenforthewin/atomic-editor)
- [codemirror-live-markdown 設計メモ](https://github.com/blueberrycongee/codemirror-live-markdown/blob/main/CODEMIRROR_LIVE_PREVIEW_DESIGN.md)
