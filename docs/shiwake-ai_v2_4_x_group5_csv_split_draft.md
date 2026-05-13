# shiwake-ai v2.4.x Group 5 — CSV 500件超分割 仕様検討ドラフト

> 作成日: 2026-05-13  
> ステータス: **ドラフト（DSK判断待ち）**  
> 担当: 実装前の仕様検討フェーズ。本ファイルはコード変更なし。  
> 関連コミット: 7f7e444（v2.4.1 弥生分割実装）

---

## 0. 現状コード調査サマリ

Group 5 の設計にあたり、既存コードを調査した結果を記す。

### 0-1. `generateCsvContent()` — server.js:358

```
戻り値: [{ filename, content }, ...]  // v2.4.1 以降は常に配列
```

- 入力: `{ records, format, includeWsName, wsNameMap, yayoiSplitMode, baseName }`
- 弥生 + `yayoiSplitMode === 'by_credit_account'` の場合のみ複数要素を返す
- それ以外は常に 1要素（`baseName.csv` or `baseName.txt`）
- ファイル名の `baseName` は `${wsSlug}_${format}_YYYYMMDD-HHmmss` 形式
- **現状: 件数ベース分割ロジックなし**

### 0-2. `executeAutoExport()` — server.js:410

呼び出しフロー:

```
checkAutoExportTrigger()
  → unexported_count >= threshold なら非同期起動
    executeAutoExport()
      1. WS設定取得（auto_export_yayoi_split_mode 含む）
      2. 未エクスポートレコード全件取得（records 配列）
      3. generateCsvContent() で files 配列生成
      4. 配送先ループ（email / cloud / local）
      5. exported_at 更新（SELECT 時点の id に限定 → race condition 防止済み）
```

- **現状: records を件数で分割する処理なし**
- 配送先ごとの挙動はすでに `files` 配列を繰り返す設計になっており、複数ファイルへの対応は基本的に構造上は済んでいる

### 0-3. `sendEmailWithAttachments()` — server.js:241

- SendGrid の `/v3/mail/send` を直接呼ぶ
- `files` 配列をそのまま `attachments` 配列にマッピング
- **コード上の件数・サイズ上限チェックなし**
- SendGrid の実際の制限: **添付ファイル合計 30MB、添付ファイル数制限なし**（公式ドキュメントより）

### 0-4. `checkAutoExportTrigger()` — server.js:587

- `auto_export_threshold`（デフォルト 30）を超えたらトリガー
- **500件超は「通常運用では発生しない安全弁」**（引き継ぎ v2.4.3 §6 より）
  - 理由: threshold=30 で都度エクスポートするため、未エクスポート件数が 500件を超えるのは配送失敗が続いた場合のみ

### 0-5. DB 現状（workspaces テーブル）

| カラム | 型 | デフォルト |
|---|---|---|
| `auto_export_enabled` | BOOLEAN | FALSE |
| `auto_export_threshold` | INTEGER | 30 |
| `auto_export_yayoi_split_mode` | TEXT | 'single' |
| `auto_export_format` | TEXT | 'yayoi' |
| `auto_export_destinations` | JSONB | '["email"]' |
| `auto_export_cloud_folder_path` | TEXT | NULL |

### 0-6. `shiwake_exports` テーブル

| カラム | 備考 |
|---|---|
| `id` | UUID, エクスポートID（exportId） |
| `record_count` | 対象件数（全件、分割前） |
| `output_destinations` | JSONB（配送先ごとの成功/失敗） |
| `status` | 'pending' → 'success' or 'failed' |
| `csv_storage_path` | ローカルDL配送用の最初のファイルパス |

- **現状: 1トリガー = 1行**。複数ファイル分割時の扱いは未設計。

---

## 1. 基本仕様（論点 1）

### 現状

`generateCsvContent()` は v2.4.1 で弥生の貸方科目別分割に対応した。
ただし「件数ベースの分割（500件超）」は未実装。

### 分割の位置づけ

引き継ぎドキュメント（v2.4.3 §6）より:

> 500件バッチ分割: `executeAutoExport()` で未エクスポート仕訳を取得する際、500件ずつバッチに分割。
> 通常運用（threshold=30）では発生しない、配送失敗が続いた場合の安全弁。

**前提**: Group 5 の 500件分割は「安全弁」機能。日常的なユースケースではなく、異常系（長期配送失敗）で大量の未エクスポート仕訳が溜まったときの対処として実装する。

### 拡張子

- 弥生: `.txt`（v2.4.1 で確定済み）
- freee / MF / OBC / 汎用: `.csv`

---

## 2. ファイル名規則（論点 2）

### 現状

`baseName` = `${wsSlug}_${format}_YYYYMMDD-HHmmss`

弥生の貸方科目別分割ではすでに:
```
default_yayoi_20260513-153000_現金.txt
default_yayoi_20260513-153000_未払金.txt
```

### 選択肢

#### 案A: サフィックス方式 `_part1`, `_part2` ...

```
default_freee_20260513-153000_part1.csv
default_freee_20260513-153000_part2.csv
```

- シンプル
- 弥生 `by_credit_account` との組み合わせ時は命名が煩雑になる可能性
  - 例: `default_yayoi_20260513-153000_現金_part1.txt`

#### 案B: サブフォルダ方式

```
batch_20260513-153000/
  file001.csv
  file002.csv
```

- クラウド配送（Dropbox/GDrive）では自然
- メール配送では添付ファイルがフォルダ構造を持てないため別処理が必要
- `local` 配送の Supabase Storage パス `${uid}/${exportId}/` はすでにフォルダ相当の構造

#### 推奨（未確定）

**案A** を推奨。理由:
- 実装がシンプル（`baseName + '_part' + i`）
- 既存の弥生分割と命名規則が統一可能
- メール・クラウド・ローカル全配送先で同じロジックが使える

→ **DSK に確認**: 案A / 案B のどちらが好ましいか？

---

## 3. 分割ロジック（論点 3）

### 選択肢

#### 方式1: 機械的 500件単位スライス（推奨）

```js
// executeAutoExport() 内、generateCsvContent() 呼び出し前に挿入
const SPLIT_SIZE = 500;
const chunks = [];
for (let i = 0; i < records.length; i += SPLIT_SIZE) {
  chunks.push(records.slice(i, i + SPLIT_SIZE));
}
// chunks.length === 1 なら従来通り、2以上なら part1/part2...
```

- 実装: `executeAutoExport()` 内の `generateCsvContent()` 呼び出し前に記録を 500件ずつに切る
- `generateCsvContent()` 自体は変更不要（各チャンクをそのまま渡す）
- `baseName` に `_part${i+1}` をサフィックスとして付与

#### 方式2: 取引先別・日付別などの意味のある分割

- 会計ソフトへのインポートを考えると、意味単位の方がユーザーフレンドリー
- ただし既に貸方科目別分割（弥生）が存在し、これ以上の意味分割は複雑度が急増する
- 通常は発生しない安全弁機能に、この複雑さは不要と判断

#### 推奨（未確定）

**方式1（機械的スライス）** を推奨。理由:
- 実装コスト最小
- 安全弁機能に意味分割は過剰
- 方式1 でも十分に目的（大量データの配送失敗防止）を果たせる

→ **DSK に確認**: 意味ある分割の要望はあるか？

---

## 4. 弥生分割モードとの組み合わせ（論点 4）

弥生の `by_credit_account` 分割（貸方科目別）と件数 500 分割の両方が有効な場合、どう動作するか。

### 現状の弥生分割実装（server.js:394-405）

```
records
  → 貸方科目でグループ化
  → 科目ごとに1ファイル
```

### 組み合わせ時の選択肢

#### 選択肢1: 貸方科目内で 500件超えたら更に分割

```
現金グループ(800件) → 現金_part1(500件), 現金_part2(300件)
未払金グループ(120件) → 未払金(120件)
```

- 最も自然な動作
- 実装: `generateCsvContent()` の `by_credit_account` ブランチ内でさらにスライス処理を追加

#### 選択肢2: 先に 500件単位でスライス、各チャンクに弥生分割適用

```
レコード全体(920件)
  → chunk1(500件): 現金_part1, 未払金_part1...
  → chunk2(420件): 現金_part2, 未払金_part2...
```

- チャンクをまたいで同じ貸方科目のファイルが分かれる → 混乱しやすい
- 非推奨

#### 選択肢3: 件数分割は弥生分割より「外側」で適用

- 選択肢1 と実質的に同じ結果だが、実装の切り口が異なる
- `generateCsvContent()` の中で両方を組み合わせて処理する

#### 推奨（未確定）

**選択肢1** を推奨。ただし実装上は:

- `generateCsvContent()` に `countSplitSize` オプションを追加し、内部でチャンク処理する
- または `executeAutoExport()` 側で: `by_credit_account` ならグループ化後に各グループを 500件スライス

→ **DSK に確認**: 通常使用では貸方科目別 × 500件超は起こり得るか？（安全弁として想定するか）

---

## 5. 配送方法ごとの挙動（論点 5）

### 5-1. メール（SendGrid）

#### 現状

`sendEmailWithAttachments()` は全 files を `attachments` 配列に入れて1通送信。
コード上の上限チェックなし。

#### SendGrid の制限

- **添付合計サイズ**: 30MB（公式制限）
- **添付ファイル数**: 上限なし（ただし 1通あたりのメールサイズが 30MB 以内）
- 500件の CSV は 1件あたり約 200〜300 バイト想定 → 500件 ≒ 100〜150KB → 問題なし
- 1000件（500×2ファイル）でも 200〜300KB 程度 → SendGrid 制限にはまず到達しない

#### 検討すべき点

1. 添付ファイルが多数になると**メール本文の視認性が下がる**
   - 現状: `splitNote`（ファイル数のお知らせ）はすでに実装済み（server.js:484-485）
   - 特に追加 UI 改修は不要か

2. 大量ファイルを分割送信するか（メール複数通）vs 1通に全部添付するか
   - 安全弁用途（稀なケース）なので1通に全添付でよいと思われる

#### 推奨

現状の1通全添付のまま。splitNote テキストを件数分割の場合も適切に表示するよう調整するのみ。

### 5-2. クラウド（Dropbox / GDrive）

#### 現状

`executeAutoExport()` 内 cloud 配送ブランチ（server.js:501-530）は:
- `files` 配列をループして1ファイルずつアップロード
- **同フォルダに複数ファイル**投入（サブフォルダ作成なし）

#### 500件分割時の動作

- 現状ロジックをそのまま使えば、part1/part2/... が同フォルダに入る
- **追加実装なし** で動作する

#### 選択肢: サブフォルダ作成

```
/exports/batch_20260513-153000/
  default_freee_20260513-153000_part1.csv
  default_freee_20260513-153000_part2.csv
```

- Dropbox: `uploadToDropbox()` のパスを `${folderPath}/${batchFolder}/${fn}` に変更
- GDrive: フォルダIDを事前に作成してから `uploadToGDrive()` を呼ぶ

→ **DSK に確認**: クラウド配送でサブフォルダ作成は必要か？（通常は発生しない安全弁なのでフラットでよいか）

### 5-3. ローカルDL通知（Supabase Storage）

#### 現状

`executeAutoExport()` 内 local 配送ブランチ（server.js:531-540）:
- `${uid}/${exportId}/${fn}` パスにアップロード
- `csvStoragePath` には最初のファイルのパスのみ保持

#### 500件分割時の問題

- `csvStoragePath` が1つしかない → 複数ファイルのうち最初のもののみ記録される
- ユーザーへの DL 通知 UI がファイル1つしか提示できない可能性

#### 選択肢

1. `shiwake_exports` テーブルの `csv_storage_path` を JSON 配列に変更
2. `csv_storage_path` は「エクスポートフォルダパス」として `${uid}/${exportId}/` を保持し、フロントがフォルダ内一覧を取得
3. 初回実装は「分割ファイルの1つ目のみ DL リンク提示 + "N ファイルに分割"の注記」でよしとする

→ **DSK に確認**: ローカルDL は現在どのくらい使われているか？（優先度の判断材料）

---

## 6. DB 追加カラム検討（論点 6）

### 選択肢

#### 選択肢A: `workspaces` に `auto_export_split_count_threshold INT DEFAULT 500` を追加

```sql
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS auto_export_split_count_threshold INT NOT NULL DEFAULT 500;
```

- UI に設定項目を追加すれば、ユーザーが分割単位を変更できる
- 柔軟性あり、ただし設定項目が増えて複雑になる

#### 選択肢B: 固定 500 でハードコード

```js
const CSV_SPLIT_SIZE = 500; // server.js 定数
```

- 実装シンプル
- 「安全弁」としての性格と合致（ユーザーが意識・操作する設定ではない）
- 変更するなら server.js の定数を直せばよい

#### 推奨（未確定）

**選択肢B（固定 500 ハードコード）** を推奨。理由:
- 通常は発生しない安全弁機能に UI 設定は不要
- `auto_export_threshold` と名前が似ており、混乱を招く可能性
- 後から柔軟化が必要になれば選択肢A に移行可能

→ **DSK に確認**: ユーザーが分割サイズを設定できる必要性はあるか？

---

## 7. UI/UX（論点 7）

### 設定 UI の変更

#### 現状

WS編集モーダルの「STEP 02: 何を出力する?」に:
- 出力単位（per_workspace / merged）
- 会計ソフト形式（yayoi / freee / mf / obc / generic）
- 弥生追加設定カード（single / by_credit_account）

#### 500件分割の UI 扱い

**パターン1: 設定不要、自動動作（推奨）**

- 分割サイズを 500 固定にした場合、ユーザーが意識する必要はない
- 自動エクスポートが実行されたときに「3ファイルに分割して送信しました」と通知するだけ
- STEP 02 に項目追加なし

**パターン2: STEP 02 に表示のみ追加**

```
📎 1回のエクスポートが500件を超える場合は自動的に複数ファイルに分割します
```

- ヒントテキストとして小さく表示するだけ（インタラクションなし）
- 弥生追加設定カード内に追加するか、STEP 02 下部に追加

**パターン3: スライダー or 数値入力で分割サイズ設定**

- 選択肢A（DB カラム追加）と組み合わせる場合
- オーバーエンジニアリングの可能性

#### 推奨（未確定）

**パターン1（設定なし、自動動作）** を推奨。理由:
- 「安全弁」なのに設定項目を追加すると、ユーザーが誤って小さな値に設定する可能性
- 通常は見えない・触らない機能として実装する

→ **DSK に確認**: ユーザーへの「分割された」通知は必要か？（エクスポート履歴 Group 5 で別途実装予定あり）

---

## 8. 既存コードへの影響と修正箇所（論点 8）

### 変更が必要な箇所

| 場所 | 変更内容 | 難易度 |
|---|---|---|
| `server.js:410` `executeAutoExport()` | `records` を 500件ずつチャンクに分割し、チャンクごとに `generateCsvContent()` を呼ぶ | 低 |
| `server.js:358` `generateCsvContent()` | 件数分割は `executeAutoExport()` 側で行う設計なら変更不要。ただし `by_credit_account` × 500件の組み合わせを内部で扱うなら修正 | 中 |
| `server.js:241` `sendEmailWithAttachments()` | 変更不要。files 配列の長さに関係なく動作する | なし |
| `shiwake_exports` テーブル | ローカルDL の `csv_storage_path` をどう扱うか次第 | 中〜低 |

### 変更不要な箇所

- `sendEmailWithAttachments()`: すでに複数添付対応
- cloud 配送ループ（server.js:510）: `files` 配列をループしており変更不要
- local 配送ループ（server.js:533）: 同上（`csv_storage_path` の扱いを除く）
- `checkAutoExportTrigger()`: トリガー条件は変わらない

### 新規追加が必要な定数

```js
const CSV_SPLIT_SIZE = 500; // server.js 上部に追加
```

### 実装見積もり（実績ベース）

- 設計書想定: 500件分割は Group 5 の一部として「1.5〜2h」
- `generateCsvContent()` + `executeAutoExport()` の修正は比較的シンプル（0.5〜1h）
- ローカルDL の複数ファイル対応をどうするかで変動（+0.5〜1h）

---

## 9. DSK が判断すべき主要論点 Top3

### 🔴 最優先: ファイル名規則（案A vs 案B）

**案A**: `default_freee_20260513-153000_part1.csv`  
**案B**: `batch_20260513-153000/file001.csv`（サブフォルダ）

実装方針全体に影響する。メール配送との兼ね合いで案Aが有利だが、DSK の好みで決める。

### 🔴 最優先: ローカルDL の複数ファイル対応

`shiwake_exports.csv_storage_path` は現在1つのファイルパスしか持てない。
- 選択肢1: カラムを JSON 配列に変更（DB マイグレーション必要）
- 選択肢2: 初回は「1つ目のファイルへのリンク + N ファイルに分割の注記」で妥協

Group 5 のローカルDL 通知実装と合わせて設計する必要がある。

### 🟡 重要: 弥生 `by_credit_account` × 500件超の組み合わせ

通常は発生しないが、「貸方科目 A が 600件」の場合:
- 科目 A 内でさらに分割するか（自然だが実装コスト増）
- 科目別 × 件数は二重分割なので、件数分割は科目別より優先するか

→ 「安全弁機能なのでシンプルに」なら、科目別分割を無効化して件数優先でもよい。

---

## 10. 気になった点（CC 所見）

1. **`shiwake_exports.created_at` 重複**: `INSERT` 時に `created_at` と `triggered_at` 両方を設定しているが（server.js:461-467）、両方同じ値で冗長。将来整理可能。

2. **SendGrid の 30MB 制限**: 500件×2ファイルは ~300KB なので問題ないが、`output_unit = 'merged'`（複数 WS 統合）で大量レコードがある場合は理論上限界に近づく可能性。通常は threshold=30 で防がれるため実害はほぼないが、ドキュメント上に制限を明記してもよい。

3. **`exported_at` 更新のタイミング**: 現在は「全配送先のいずれかが成功」したら更新（anySuccess）。500件分割の場合、「part1 成功・part2 失敗」のケースで `exported_at` がセットされ、part2 の仕訳が永久に再エクスポートされない状態になる可能性。→ 全チャンク成功時のみ `exported_at` を更新するか、部分成功の場合の処理を明確化する必要あり。

4. **`csv_storage_path` の格納**: `shiwake_exports` テーブルの `csv_storage_path` には最初のファイルパスのみが入る（`if (!csvStoragePath) csvStoragePath = ...`）。複数ファイルの2つ目以降は記録されない。現状でも弥生 `by_credit_account` 分割で同じ問題が潜在する。

---

> **次アクション**: DSK が上記 Top3 を判断 → 判断内容をこのファイルに追記 → CC に実装依頼
>
> 最終更新: 2026-05-13 (CC 調査 + ドラフト作成)
