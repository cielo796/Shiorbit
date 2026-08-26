# Shiorbit — Phase 5

Obsidian 互換のローカル Markdown ノートアプリ。ノートの実体は普通の `.md` ファイルで、
アプリを捨てても資産が残ります。

| 文書 | 内容 |
|---|---|
| [DESIGN.md](./DESIGN.md) | 設計 — アーキテクチャ、データモデル、境界、フェーズ計画 |
| [CONVENTIONS.md](./CONVENTIONS.md) | コード規約 — 実装時に守るルールと、それを検査する仕組み |
| [PHASE5.md](./PHASE5.md) | 次フェーズの実装仕様 — 現状の棚卸しと機能仕様 |
| README.md（この文書） | 使い方・ビルド手順・できること |

**このリポジトリは Phase 5 を実装中です。** Phase 0〜4（土台 / ナレッジベース化 / 実用化 / グラフ / アプリ化）は完了し、
アウトライン・リンクのリネーム追従に加えて、新規作成・表示の拡大縮小・設定画面・位置の復元まで利用できます。

---

## 動かす

### 1. Node.js を入れる

https://nodejs.org/ から **LTS 版**をダウンロードしてインストールします。
インストール後、ターミナル（PowerShell）で確認：

```bash
node -v    # v20 以上なら OK
```

### 2. 依存パッケージを入れる（初回だけ）

```bash
cd D:\code\Shiorbit
npm install
```

### 3. 起動する

```bash
npm run dev
```

ブラウザが自動で開きます（http://localhost:5173）。
開かない場合は手動でその URL を開いてください。

> **PC の Chrome または Edge で開いてください。**
> フォルダを直接読み書きする File System Access API が、この2つでしか動きません。
> Safari や Firefox で開くと「デモモード」（メモリ上で動作・保存されない）になります。
> スマホ対応は Phase 4 で Capacitor を使って行います。

### 4. 使う

1. 「フォルダを開く」を押して、ノートを置くフォルダを選ぶ
2. 「+ 新規」でノートを作る（`AI/Ollama` のようにフォルダ付きでも可）
3. 本文に `[[別のノート名]]` と書くとリンクになる（`[[` を打つと候補が出ます）
4. 編集すると 0.5 秒後に自動保存される（`Ctrl+S` で即保存）

選んだフォルダの中に、本物の `.md` ファイルが作られます。
エクスプローラーで開いても、メモ帳で開いても、VS Code で開いても、Git で管理してもかまいません。

既存の `.html` / `.htm` ファイルもツリーから開いて編集・保存できます。HTML は専用の
シンタックスハイライトで表示され、全文検索とクイックスイッチャの対象になります。
`<a href>` と `<img src>` は Vault 内のリンクとして数えるので、HTML もバックリンク・
未解決リンク・グラフに現れ、リンク先を改名すれば href も相対のまま追従します。
タグ、テンプレートなど、その他のMarkdown固有の機能は `.md` ファイルだけが対象です。
ファイルツリー上部の「両方 / MD / HTML」で、表示するファイル形式を切り替えられます。
HTMLは安全な「プレビュー」が既定表示です。「ソース」に切り替えると編集でき、再び
プレビューへ戻すとCSSを反映して表示します。プレビューではJavaScript、イベント属性、
危険なURL、埋め込みフレームを除去し、JavaScript権限のないsandbox内で描画します。

### ショートカット

| キー | 動作 |
|---|---|
| `Ctrl+O`（`Ctrl+P`） | ノートを切り替える（無い名前を入れるとその場で作成） |
| `Ctrl+Shift+P` | コマンドパレット（すべての操作はここから探せます） |
| `Ctrl+Shift+F` | 全文検索 |
| `Ctrl+Shift+D` | 今日のノートを開く |
| `Ctrl+G` | グラフを開く |
| `Ctrl+S` | すぐ保存する |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | 表示を拡大 / 縮小 / 等倍に戻す（`Ctrl+ホイール`も同じ） |
| `Ctrl+Enter` | カーソル位置のリンクを開く |
| `Ctrl+クリック` | リンクを開く |

> リンクを **素のクリック**ではなく `Ctrl+クリック` にしているのは、
> 素のクリックを移動に使うとリンクの中にカーソルを置けなくなり、編集できなくなるためです。
> Obsidian や VS Code と同じ挙動です。移動だけしたいときは右ペインの「リンク先」から辿れます。

---

## できること

### Phase 0（土台）

- 実フォルダを開く（前回のフォルダは記憶される）
- ファイルツリーの表示・フォルダの開閉
- Markdown の編集（シンタックスハイライト・行番号・検索・Undo）
- 自動保存（500ms デバウンス ＋ タブ切替・離脱時は即保存）
- 外部変更の検知（5秒ごとのポーリング ＋ ウィンドウ復帰時）
- 競合の解決（失われる側は必ず `.conflict-YYYYMMDD-HHmm.md` に退避）
- ノートの作成・削除

### Phase 1（ナレッジベース化）

- **`[[WikiLink]]`** — `[[名前]]` `[[名前|表示名]]` `[[名前#見出し]]` `[[名前#^ブロックID]]` `![[埋め込み]]`
  に対応。コードブロックの中は無視します。
- **リンク解決** — 完全一致パス → basename が一意 → 複数ならリンク元に近いもの、の順で解決します
  （設計書 §5）。大文字小文字は区別せず、frontmatter の `aliases` も引きます。
- **バックリンク** — 右ペインに「このノートを参照しているノート」を、
  リンクが書かれている**行そのもの**と一緒に表示します。行をクリックするとその位置へ飛べます。
- **未解決リンク** — まだ存在しないノートへの言及を薄いオレンジで表示し、
  左サイドバーの「未解決」タブに一覧します。クリックするとその場で作成できます。
  *「まだ書いていないノートのリスト」がそのまま次に書くべきものになります。*
- **全文検索** — 左サイドバーの「検索」タブ。日本語に対応しています（後述）。
- **クイックスイッチャ** — `Ctrl+O`。名前の一部で絞り込み、無ければその名前で新規作成。
- **リンク補完** — 本文で `[[` を打つと候補が出ます。同名ノートが複数ある場合だけフルパスで挿入します。
- **タグの収集** — 本文の `#タグ` と frontmatter の `tags` を集計します（タグ UI は Phase 2）。

### Phase 2（実用化）

- **Live Preview** — `**強調**` や `[[リンク]]` の記法を隠して読みやすく表示します。
  **カーソルが乗っている行だけは生の Markdown** を見せるので、いつでも編集できます。
  隠した範囲は「不可分」として登録してあり、カーソルが中に迷い込みません。
  合わなければ設定でオフにできます。
- **タグ** — 左サイドバーの「タグ」タブ。本文の `#タグ` と frontmatter の `tags` を集計し、
  クリックでそのタグの付いたノートを開けます。
- **Daily Notes** — `Ctrl+Shift+D` で今日のノート（既定は `Daily/YYYY-MM-DD.md`）。
  無ければテンプレートから作ります。フォルダ・日付書式・テンプレートは設定で変えられます。
- **テンプレート** — `Templates/` の .md をカーソル位置に挿入。
  `{{title}}` `{{date}}` `{{time}}` `{{date:YYYY年M月D日(ddd)}}` が展開されます。
- **テーマ** — ダーク / ライト。
- **コマンドパレット** — `Ctrl+Shift+P`。ホットキーとパレットが同じ定義を参照するので動作がズレません。
- **設定画面** — 設定は Vault の中（`.shiorbit/settings.json`）に保存されます。
  Vault と一緒に同期されるので、端末を変えても設定が付いてきます。
- **インデックスの差分更新** — 起動のたびに全件読み直すのをやめました（後述）。

### Phase 3（グラフ）

- **ローカルグラフ** — 右ペインに、開いているノートの周辺だけを描きます。
  深さ 1 / 2 / 3 を切り替えられます。既定は 2。
- **全体グラフ** — `Ctrl+G` で画面いっぱいに表示します。
  ノート名での絞り込み、未解決リンクの表示切替、現在のノート周辺だけに限定、が可能です。
- **操作** — ドラッグでパン、ホイールでズーム、ノードをドラッグして動かす、
  ホバーで隣接を強調、クリックで移動。未解決ノード（オレンジ）をクリックするとその場で作成できます。
- **ラベルの間引き（LOD）** — ズームアウトするほど、ノードが多いほど、名前の表示を絞ります。
  全部出すと文字が重なって何も読めなくなるためです。

### Phase 4（アプリ化）

- **iOS / Android アダプタ** — `@capacitor/filesystem` 越しに端末の実フォルダを読み書きします。
  iOS の Vault は `Documents/Obdisan/`。「ファイル」アプリに現れ、iCloud Drive で PC と同期できます。
  Android は初回起動時にシステムのフォルダ選択画面から `Documents/Obdisan/` を選びます。Storage Access Framework の永続URI権限を使うため、Android 11以降でも既存ファイルをそのまま読み書きできます。
  iOS で以前の `Documents/Shiorbit/` または旧版の `Documents/Obidisan/` がある場合は、初回起動時に自動で移行します。
- **Node / Electron アダプタ** — デスクトップアプリ用。`fs` を直接は触らず `FsBridge` 越しに呼ぶので、
  Electron のレンダラから preload 経由の IPC を差し込めます。
- **モバイル UI** — Markdown 記号ツールバー（`[[` `#` `- [ ]` 太字 引用 元に戻す…）、
  ボトムナビ、ソフトキーボード追従、セーフエリア対応。
- **アダプタ契約テスト** — 実機がなくても、すべてのアダプタが同じ約束を守っているか検証できます（後述）。

### Phase 5（拡張・実装中）

- **アウトライン** — 右ペインに Markdown / HTML の見出しを階層表示します。クリックで該当位置へ移動し、カーソルやスクロール位置にも追従します。
- **リンクのリネーム追従** — ファイルツリーの鉛筆ボタンまたはコマンドパレットからノート名を変更できます。実行前に対象ノート数と書き換え箇所数を表示し、同名の別ノートへ解決されるリンクは変更しません。
- **新規作成** — 「+」または フォルダ行の「＋」から、Markdown / HTML / フォルダを選んで作れます。
  名前を打つと**どこに何ができるか**を押す前に表示します。`page.html` のように拡張子を書けばその形式になります。
  入力や確認はすべてアプリ内のダイアログです（Electron には `window.prompt` が無いため）。
- **表示の拡大・縮小** — `Ctrl+=` / `Ctrl+-` / `Ctrl+0`、`Ctrl+ホイール`。HTML プレビューにも効きます。
  基準の文字サイズ（UI / エディタ）は設定から別々に変えられます。
- **読んでいた位置を保つ** — ノートを切り替えて戻っても、カーソルとスクロール位置が復元されます。
  外部の変更を読み込んだときも位置を保ちます。HTML はプレビューとソースの間で見出し単位に位置を合わせます。
- **埋め込み** — `![[画像.png]]` は本文に画像として出ます（`.png .jpg .jpeg .gif .webp .svg .avif .bmp`）。
  `![[ノート]]` はそのノートの中身を、`![[ノート#見出し]]` はその節だけを引用表示します。
  **展開は1階層まで**です（埋め込みの中の埋め込みは辿りません。循環参照で止まらなくなるため）。
  画像の ObjectURL は 50 件の上限つきで管理し、あふれた分と Vault を閉じるときに必ず解放します。
- **Bases** — `.base`（YAML）を置くと、frontmatter のプロパティを表として見られます。
  「+ 新規」の **Base** で作れます。フォルダとタグで対象を絞り、`where` で条件を付け、
  列ヘッダのクリックで並べ替え、行のクリックでそのノートを開きます。
  組み込みの列は `file.name` `file.path` `file.mtime` `file.size` `file.tags` です。
  **v1 は読み取り専用**です（セル編集は入れていません）。
- **設定画面** — 変更は保存前にその場で反映され、閉じれば元に戻ります。
  表示倍率・文字サイズ・HTML の既定表示・自動保存の待ち時間・外部変更を見に行く間隔を変えられます。

まだ無いもの: Canvas（Phase 5）、プラグイン API・Webクリッパ（Phase 6）。

### 境界の答え合わせ

Phase 0 で `VaultAdapter` という境界を引いたのは、
「あとからスマホ対応するときにアプリ本体を作り直さずに済むように」でした。
Phase 4 はその答え合わせです。**Phase 3 → Phase 4 で変わったファイル**:

| 場所 | 変更 | 内訳 |
|---|---|---|
| `src/core/` | **0 ファイル / 0 行** | — |
| `src/adapters/` | 新規5・変更1 | capacitor / capacitorKv / node / nodeFs / nativeVault / detect |
| `src/main.ts` | 54 行 | 合成ルート。環境を見てアダプタを選ぶ |
| `src/ui/` | 新規3・変更2 | モバイル UI の**追加**（プラットフォーム対応で強いられた変更ではない） |

つまり **プラットフォーム対応のために書いたコードは、すべて `src/adapters/` と `src/main.ts` に収まりました。**
`src/ui/` の変更はキーボード用ツールバーなどの新機能で、
「iOS だからこう書き直す」という類のものは1行もありません。

これは運が良かったのではなく、`npm run check:boundary` が毎回
`showDirectoryPicker` や `Capacitor` や `node:fs` が外へ漏れていないか見張っていた結果です。

## モバイル / デスクトップアプリのビルド

### iOS（Mac + Xcode が必要）

```bash
npm install
npm install @capacitor/ios
npx cap add ios
npm run cap:ios          # ビルド → 同期 → Xcode を開く
```

**Xcode で `ios/App/App/Info.plist` に次の2つを追加してください。**
これが無いと Vault が「ファイル」アプリに現れず、iCloud 同期もできません。

```xml
<key>UIFileSharingEnabled</key>
<true/>
<key>LSSupportsOpeningDocumentsInPlace</key>
<true/>
```

### Android（Android Studio が必要）

```bash
npm install @capacitor/android
npx cap add android
npm run cap:android
```

Android では SAF（Storage Access Framework）のシステム画面で選んだ任意のフォルダを Vault として使います。
選択時の読み書き権限は再起動後も維持され、「設定を解除」しても Vault 内の実ファイルは削除されません。
iOS ではアプリの `Documents/Obdisan/` を使います。

### デスクトップ（Electron）

Windows 実機で動作確認済みです。

```bash
npm run electron:dev     # 開発（Vite を別ターミナルで起動しておく）
npm run electron:build   # インストーラを作る
```

メインプロセスは `electron/main.cjs`、preload は `electron/preload.cjs` にあります。
レンダラから `fs` は触れないので、preload で公開した IPC を `FsBridge` として渡す形です。

```ts
// レンダラ側
import { createNodeAdapter } from './adapters/node';
const adapter = createNodeAdapter(window.shiorbitFs, vaultPath);
```

`src/adapters/nodeFs.ts` に `node:fs/promises` を使った実装があります
（メインプロセス側でそのまま使えます。ブラウザ向けバンドルには入りません）。

### 同期について

アプリ自身は同期しません。ファイルが実体なので外部に任せるのが最も堅い、という設計です（設計書 §9）。

| 環境 | 推奨 |
|---|---|
| iOS | ファイルアプリ経由で iCloud Drive |
| Android | Google Drive / Syncthing |
| PC | OneDrive / Dropbox / **Git** |

同時編集で衝突しても、失われる側は必ず `.conflict-YYYYMMDD-HHmm.md` として残ります。

### グラフが重くならない理由

力学計算（ノードを引き合わせ、反発させる計算）は **Web Worker に隔離**してあります。
メインスレッドは Worker から届いた座標を Canvas に描くだけなので、
計算中でもスクロールや入力が引っかかりません（設計書 §10）。

反発力の計算は素朴に書くと総当たりで O(n²) になりますが、
d3-force が四分木による **Barnes-Hut 近似**を使うため O(n log n) で済みます。

実測（`npm test` の性能テストが毎回計測しています）:

```
1000ノード x 200ステップ: 約 600ms（1ステップあたり 約3ms）
```

1ステップ 3ms は Worker 側の話で、しかもメインスレッドの描画とは別勘定です。
設計書 §12 の完了条件「1000ノードで滑らかに動く」を満たしています。
これを大きく超える規模になったら WebGL に載せ替えます。

### 起動が速い理由（インデックスの差分更新）

Phase 1 までは起動のたびに全ノートを読み直していました。Phase 2 では、
前回のインデックス（リンク構造と全文検索の索引）を IndexedDB に保存しておき、
起動時に **ファイルの更新時刻だけを突き合わせて、変わったノートだけ読み直します**。

```
起動
 ├─ キャッシュを読み込む
 ├─ Vault を列挙して path + mtime を取る
 ├─ mtime が同じノート → キャッシュをそのまま使う
 └─ 変わった／増えたノートだけ read + 解析
```

キャッシュが古い・壊れている・別の Vault のものだった場合は、黙って全件スキャンに戻ります。
キャッシュは「あれば速い」だけのものなので、少しでも怪しければ捨てるのが正しい判断です。
状態は起動時のトースト（`再利用 N / 再読込 M`）とステータスバーで確認できます。

### 日本語の全文検索について

空白で区切る一般的な検索は日本語で機能しません（「ローカルLLMの実行環境」が丸ごと1語になってしまう）。
そこで **ラテン文字と数字は単語単位、日本語は2文字ずつのビグラム**に分割しています。
形態素解析の辞書を持たずに部分一致を成立させる、軽くて確実な方法です。

```
"ローカルLLM" → ["ロー", "ーカ", "カル", "llm"]
```

このおかげで「ローカル」「実行環境」「カレー」のような部分文字列で検索できます。

---

## コマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバを起動 |
| `npm test` | テストを実行（ブラウザ不要） |
| `npm run check` | 境界チェック ＋ 型チェック ＋ テスト |
| `npm run check:boundary` | 境界チェックのみ |
| `npm run build` | `npm run check` の後に本番ビルド |

---

## 構造 — 「境界」がどこにあるか

このプロジェクトで最も重要なのは、**プラットフォーム固有のコードが
`src/adapters/` の中だけに閉じ込められている**ことです（設計書 §13）。

境界は2つあります。ファイルの読み書きを抽象化する `VaultAdapter` と、
インデックスのキャッシュ置き場を抽象化する `KeyValueStore` です。
どちらも core / ui からは interface としてしか見えません
（`indexedDB` という単語は `src/adapters/` の外に一度も出てきません）。

```
src/
├─ main.ts                     合成ルート。adapters を import してよい唯一の場所
├─ core/                       ← プラットフォームを知らない。ブラウザなしでテストできる
│  ├─ vault/
│  │  ├─ VaultAdapter.ts       ★ 境界そのもの。interface だけで実装は1行も無い
│  │  ├─ VaultService.ts       アプリから見た Vault の窓口
│  │  └─ types.ts  errors.ts  path.ts
│  ├─ markdown/
│  │  ├─ wikilink.ts           [[...]] のパーサ
│  │  ├─ scan.ts               本文 → NoteMeta（見出し・タグ・リンク・ブロックID）
│  │  ├─ frontmatter.ts        YAML frontmatter
│  │  ├─ section.ts            #見出し / #^ブロックID の切り出し（埋め込み用）
│  │  └─ code.ts               コード領域のマスキング
│  ├─ index/
│  │  ├─ Indexer.ts            リンクグラフと全文検索の司令塔
│  │  ├─ resolver.ts           リンク解決の4段階規則（設計書 §5）
│  │  ├─ IndexCache.ts         キャッシュの形式と検証
│  │  └─ SearchService.ts      日本語対応トークナイザ＋MiniSearch
│  ├─ storage/
│  │  └─ KeyValueStore.ts      ★ 2つ目の境界。キャッシュの置き場所を抽象化
│  ├─ graph/
│  │  ├─ buildGraph.ts         リンク構造 → グラフ（フォーカス・絞り込み・上限）
│  │  ├─ layout.ts             d3-force による力学レイアウト
│  │  └─ types.ts
│  ├─ bases/                   types.ts / parse.ts（.base の読み書き）/ query.ts（純粋な問い合わせ）
│  ├─ settings/Settings.ts     .shiorbit/settings.json（範囲検証・プレビュー）
│  ├─ commands/CommandRegistry.ts
│  ├─ refactor/                planRename.ts（影響範囲）/ renameLink.ts（書き換え）
│  └─ notes/                   date.ts（日付書式）/ template.ts（変数展開）
│                              newDocument.ts（新規作成のパス解決と検査）
├─ adapters/                   ← プラットフォーム差分はここだけ
│  ├─ fsa.ts                   PC ブラウザ（File System Access API）
│  ├─ capacitor.ts             iOS / Android（@capacitor/filesystem）
│  ├─ androidSaf.ts            Android の任意フォルダ（Storage Access Framework）
│  ├─ capacitorKv.ts           モバイルのキャッシュ（アプリ専用領域にファイルで）
│  ├─ nativeVault.ts           ネイティブ起動時の Vault を開く
│  ├─ node.ts / nodeFs.ts      Electron / Node（FsBridge 越し）
│  ├─ electron.ts              Electron のフォルダ選択と記憶
│  ├─ idb.ts / idbKv.ts        IndexedDB（ハンドル保存・インデックスキャッシュ）
│  ├─ memory.ts / memoryKv.ts  テスト用・デモ用
│  └─ detect.ts                実行環境の判定
└─ ui/
   ├─ app.ts                   全体の司令塔
   ├─ editor.ts                CodeMirror 6 ラッパ
   ├─ livePreview.ts           記法を隠す（見出し・強調・リンク・引用・水平線）
   ├─ previewState.ts          「カーソル行は隠さない」の共通判定
   ├─ wikilinkExtension.ts     リンクの色分け・conceal・Ctrl+クリック・補完
   ├─ explorer.ts              ファイルツリー
   ├─ backlinksPane.ts         右ペイン（リンク元 / リンク先）
   ├─ unresolvedPane.ts        未解決リンク一覧
   ├─ searchPane.ts            全文検索
   ├─ tagPane.ts               タグ一覧
   ├─ modalList.ts             検索欄つきモーダル（下の2つで共用）
   ├─ quickSwitcher.ts         Ctrl+O
   ├─ commandPalette.ts        Ctrl+Shift+P
   ├─ dialog.ts                prompt / confirm の代わり（Electron 対策）
   ├─ embed/
   │  ├─ embedWidget.ts        ![[...]] を本文に描く
   │  └─ attachmentUrl.ts      添付 → ObjectURL（LRU 50 件で解放）
   ├─ newDocumentDialog.ts     新規作成（種別・名前・作成先の確認）
   ├─ renameDialog.ts          改名の影響確認
   ├─ renameController.ts      改名の手順（入力 → 確認 → 書き換え → 再索引）
   ├─ outlinePane.ts           見出しツリー
   ├─ rightPane.ts             右ペインの取りまとめ
   ├─ htmlPreview.ts           HTML の防御的サニタイズと sandbox 描画
   ├─ basesView.ts             .base の表（読み取り専用）
   ├─ settingsModal.ts         設定画面
   ├─ mobileToolbar.ts         スマホの Markdown 記号ツールバー
   ├─ mobileNav.ts             スマホのボトムナビ
   ├─ viewport.ts              ソフトキーボード追従
   ├─ graph/
   │  ├─ GraphView.ts          Canvas 2D 描画・パン/ズーム・LOD
   │  ├─ graph.worker.ts       力学計算（メインスレッドから隔離）
   │  ├─ layoutSession.ts      Worker が使えない環境へのフォールバック
   │  ├─ localGraphPane.ts     右ペインのローカルグラフ
   │  └─ graphModal.ts         Ctrl+G の全体グラフ
   └─ dom.ts                   小さな DOM ヘルパ
```

`src/core` と `src/ui` は「ファイルがどう保存されるか」を一切知りません。
だから **Phase 4 でスマホ対応するときは、`adapters/capacitor.ts` を1つ足すだけ**で済みます。

### 境界が壊れていないことの確認方法

**1. 自動チェック**

```bash
npm run check:boundary
```

`showDirectoryPicker` や `FileSystemFileHandle` のようなプラットフォーム固有の識別子が
`src/adapters/` の外に出ていないか、`src/core` や `src/ui` が `src/adapters` を
import していないかを検査します。違反があればファイル名と行番号を出して失敗します。

**2. ブラウザなしでテストが通ること**

```bash
npm test
```

このテストは `MemoryAdapter`（`Map` に読み書きするだけのニセの Vault）を差し込んで、
ブラウザもファイルシステムも使わずにコアを検証します。
**これが通る = プラットフォーム依存が漏れていない**、という判定になります。

**3. アダプタ契約テスト**

`test/adapterContract.ts` に「VaultAdapter が守るべき約束」を1本にまとめてあります。
アダプタを増やしたら、この1行を書くだけで同じ基準の検証がかかります。

```ts
runAdapterContract('NodeAdapter (実ファイルシステム)', { create: ... });
```

いま3つのアダプタが同じ契約を通っています。

| アダプタ | 検証方法 |
|---|---|
| MemoryAdapter | `Map` 上で |
| NodeAdapter | **本物のファイルシステム**（一時ディレクトリ） |
| CapacitorAdapter | `@capacitor/filesystem` を真似た偽プラグイン |

実機の iPhone や Android がなくても、
「アダプタが約束を守っているか」と「アプリ本体がそのアダプタで動くか」は、ここで確認できます。
残るのは実機固有の問題（権限、iCloud の同期遅延など）だけです。

加えて `test/app.smoke.test.ts` が UI の煙感知器として、
「Vault を開く → インデックスが走る → ノートを開く → バックリンクが出る →
 Live Preview が `[[ ]]` を隠す → コマンドパレットが開く →
 ローカルグラフが描かれる → `Ctrl+G` で全体グラフが開く」までを通しで確認します。
型チェックでは見つからない「起動時に例外で落ちる」を捕まえるためのものです。

---

## Phase 0 完了チェックリスト（設計書 §13.6）

- [x] `core/vault/VaultAdapter.ts` に interface のみを定義した
- [x] `adapters/fsa.ts` と `adapters/memory.ts` の2実装がある
- [x] 禁止識別子を `src/adapters/` 外で検査してヒット0件
- [x] ブラウザ固有の型が `src/core` と `src/ui` のシグネチャに出てこない
- [x] `VaultAdapter` のメソッドが全て `Promise` を返す
- [x] `MemoryAdapter` を差し込んだテストがブラウザなしで通る（25件）
- [x] PC ブラウザでフォルダを開き、`.md` を編集・保存できる

---

## 既知の制限

- ノート名の変更時は、実際にそのノートへ解決される `[[リンク]]` だけを確認後に追従更新します。
  `LinkRef` にオフセットを持たせてあるので、実装の下地はできています。
- 埋め込んだノートは**素のテキスト**で表示します（Markdown として描き直しません）。
  1,200 文字を超える場合は打ち切ります。
- Live Preview は **行単位**で切り替わります（カーソルのある行は丸ごと生の Markdown）。
  Obsidian は要素単位ですが、行単位のほうが予測しやすく入力中にちらつかないため、
  まずはこの粒度にしています。
- 画像とコードブロックは Live Preview の対象外です（そのまま表示されます）。
- インデックスのキャッシュは Vault 名で区別しています。同じ名前の別フォルダを開くと
  キャッシュが混ざる可能性があります（mtime が合わなければ読み直すので壊れはしません）。
- グラフは無向として描きます（A→B と B→A を1本にまとめ、矢印は出しません）。
- 全体グラフは 2000 ノードで打ち切ります（次数の高い順に残します）。
  それを超える Vault では、絞り込みか「現在のノートの周辺だけ」をお使いください。
- Worker が使えない環境では、一度だけ計算した静止グラフになります（内容は同じです）。

- **モバイル実機での検証はまだです。** アダプタは契約テストを通っていますが、
  権限まわり、iCloud の同期遅延、Android の SAF は実機でしか確かめられません。
- HTML プレビューの位置合わせは**見出し単位**です。プレビューは opaque origin の
  サンドボックス内にあり、外からスクロール位置を読めないためです（読めたら防御になりません）。
  見出しの無い HTML では位置が合わせられません。
- 表示倍率は CSS の文字サイズに掛かります。余白やアイコンの大きさは変わりません。

## 次にやること（Phase 5以降）

次は埋め込みと添付表示、その後に読み取り専用 Bases、Canvas の順で進めます。プラグイン API と Webクリッパは、セキュリティモデルを先に決める Phase 6 へ分離しました。詳細は [PHASE5.md](./PHASE5.md) を参照してください。
プラグイン API を入れるならセキュリティモデル（iframe / Worker サンドボックス）を先に決める必要があります。
詳細は設計書 §11 / §12 を参照。
