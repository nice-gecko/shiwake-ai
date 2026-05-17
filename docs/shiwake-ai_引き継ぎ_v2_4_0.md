# shiwake-ai 引き継ぎ v2.4.0(自動エクスポート機能)

> 作成日: 2026-05-13
> 状態: Group 1〜3 完了 + Group 2 修正進行中 / Group 4〜5 未着手
> 次チャットへの引き継ぎ用

---

## 0. クイックリファレンス

| 項目 | 値 |
|---|---|
| プロジェクトパス | `~/APP/shiwake-ai/` |
| Supabase Project ID | `tmddairlgpyinqfekkfg`(shiwake-ai 本体、pr-agent と取り違え注意) |
| DSK Firebase UID | `6eZXyCx56ccpL2K4dYlUiYhrmbc2` |
| DSK デフォルト WS ID | `c26abe55-f82d-45f5-b393-b01453418c45`(マイワークスペース) |
| 本番 URL | shiwake-ai.com |
| 体制 | Claude(指示出し) + Claude Code(実装) |

---

## 1. プロジェクト概要・現在地

### プロジェクト
- **shiwake-ai**: 証憑→仕訳CSV化AIサービス、合同会社和泉グミ運営
- **戦略**: 税理士B2B(代理店モデル)、兄が税理士で最初の代理店候補
- **設計思想**: 「何をどう判断させるかを明確に見せる」ことで継続利用につなげる。ユーザーが自分専用ツールを育てる感覚・専門性強化感を大事にする

### 現在地(2026-05-13)
v2.4.0 = **自動エクスポート機能**を実装中。承認済み仕訳が一定数溜まったらメール/クラウド/ローカルに自動配送する機能。Group 1〜3 完了、Group 2 修正進行中、Group 4〜5 未着手。

---

## 2. v2.4.0 で完了した実装

### Group 1: DB + サーバAPI 基本(コミット 3721472)
- `shiwake_records.exported_at` 追加
- `shiwake_exports` 新規テーブル
  - status / output_destinations(jsonb) / record_count / csv_storage_path / error_message / created_at 等
- `workspaces` に `auto_export_*` 6カラム追加
  - enabled / threshold / output_unit / destinations(jsonb) / cloud_folder_path / format
- 4 API 実装:
  - GET `/api/auto-export/settings?workspace_id=...`
  - PATCH `/api/auto-export/settings`
  - GET `/api/auto-export/history`
  - POST `/api/auto-export/trigger-check`

SQL: `~/APP/shiwake-ai/sql/v2_4_0_auto_export.sql`

### Group 2: エクスポート実行エンジン(コミット 95ed32b → 0999846 配線修正)
- CSV 生成を `index.html` の `exportCSV()` からサーバ側 `generateCsvContent()` へ移植
- メール配送(SendGrid v3 API、CSV base64 添付)
- クラウド配送(Dropbox `files/upload` / GDrive `files.create`)
- ローカルDL(Supabase Storage `auto-exports` バケット、private)
- 統合関数 `executeAutoExport()`
- `/api/shiwake/approve` 末尾に `checkAutoExportTrigger()` を非同期呼び出し

### Group 3: WS編集モーダルに自動エクスポート設定セクション(コミット 6ebe5eb)
- 既存の WS編集モーダル(v2.3.2 で実装)の統計情報セクション下に「自動エクスポート設定」を追加(index.html のみ、+95行)
- CSS: `.ae-toggle-label` / `.ae-disabled` / `.ae-radio-group` / `.ae-check-group` を新規定義
- `openWsEdit()` で WS と AE 設定を `Promise.all` で並列 fetch → `renderWsEditBody(ws, ae)` へ渡す
- スイッチ ON/OFF で `.ae-disabled` クラス付け外し → 関連UI全体をグレーアウト
- クラウドチェックボックス変化でフォルダ入力欄を show/hide
- バリデーション: threshold 範囲(1〜10000) + destinations 最低1つON
- PATCH `/api/auto-export/settings`、既存 WS PATCH(name/slug/color/icon)と順次実行、片方失敗はトースト通知

### 動作確認結果(2026-05-13 16:13)
- threshold=1, destinations=["email"], format="yayoi" で動作確認成功
- 仕訳2件承認 → `/api/shiwake/approve` 200 → `shiwake_exports.status="success"` → メール到着(CSV添付)
- ファイル名: `default_yayoi_20260513-070942.csv`(365 bytes)
- 件名: 「【shiwake-ai】自動エクスポート完了 [マイワークスペース] 2件」

---

## 3. v2.4.0 Group 2 修正(進行中)

### 背景
Group 3 の UI 動作確認時に、弥生形式の仕様漏れが発覚。既存の手動エクスポート(`exportCSV()`)で実装済みの仕様と自動エクスポートが揃っていなかった。

### 確定仕様
1. **弥生選択時は `.txt` 拡張子**(他形式は `.csv` のまま)
   - 根拠: 弥生公式サポート(`page_id=29611`)で「ファイル形式: CSV形式またはテキスト形式」とあり、テキスト形式は半角カンマ区切り。弥生純正エクスポートの伝統的拡張子は .txt
   - freee の弥生形式エクスポートは .csv だが、弥生取り込み時に「ファイル形式」を「txt」から「すべて」に変更する必要があり、ユーザー体験が悪い
2. **弥生固有: 単一ファイル / 貸方科目別分割 を選択可能**
   - `workspaces.auto_export_yayoi_split_mode` カラム新設(`single` | `by_credit_account`)
   - WS編集モーダルで弥生選択時のみ「分割設定」UI 表示
3. **複数ファイル時の配送**:
   - メール: 1通に複数添付
   - クラウド: 同フォルダに複数ファイル
   - ローカル: 複数ダウンロードリンク

### 修正対象
- `generateCsvContent()` の戻り値を `[{filename, content}, ...]` 配列に変更
- 弥生 + `by_credit_account` モードのときに貸方勘定科目でグルーピング → 科目ごとに別ファイル
- ファイル名: 単一は `default_yayoi_YYYYMMDD-HHMMSS.txt`、分割は `default_yayoi_YYYYMMDD-HHMMSS_現金.txt` 等
- `executeAutoExport()` の3配送先全てを配列対応に修正
- SQL マイグレーション: `~/APP/shiwake-ai/sql/v2_4_1_yayoi_split.sql` 新規作成

### 完了報告待ち
CC が別タブで作業中。完了報告は git log origin/main -1 出力 + 動作確認用 SQL の提示で確認。

---

## 4. v2.4.0 で発覚した重大バグと修正パターン

### バグ 4-1: `/api/shiwake/approve` が誰からも呼ばれていなかった
- **症状**: v2.3.1 で実装した仕訳記録の DB 永続化が、実は使われていなかった
- **原因**: フロントの「✓承認」ボタンは `approveGroup()` → `syncSessionSave()` → `/api/session/save` のみ呼んでおり、`shiwake_records` への INSERT が永続化されていなかった
- **修正**: `approveGroup()` が各仕訳に対し `/api/shiwake/approve` を Fetch するように変更
- **副次効果**: 仕訳記録の DB 永続化が実際に動くようになった(v2.3.1 の設計通り)

### バグ 4-2: フロントが workspace_id を承認APIに渡していなかった
- **症状**: ユーザー選択中WSがデフォルトと違うと `checkAutoExportTrigger` が誤った WS を参照
- **原因**: サーバが `ensureDefaultWorkspace(uid)` でフォールバックしていた
- **修正**: index.html の approve() 呼び出しに workspace_id を明示的に追加

### バグ 4-3: NOT NULL 列漏れ連続
- **症状**: 既存テーブルへ INSERT する際に NOT NULL カラムを見落として失敗
- **対策**: 既存テーブル INSERT 前に `information_schema.columns` で必須カラムを確認する習慣を CC に徹底
- **発生箇所例**: filename, byte_size などのカラム

### バグ 4-4: CC の push 忘れ(3回発生)
- **症状**: ローカル commit のみで `git push origin main` を忘れる
- **対策**: 完了報告に **必ず `git log origin/main -1` 出力を含める** ことをルール化
- **依頼文テンプレート**: 「完了の定義は push origin main まで完走」「完了報告に必ず `git log origin/main -1` 出力を含めること」を必ず書く

### バグ 4-5: `setupAutoIntakeMenuItem()` が `onAuthStateChanged` から呼ばれず DOMContentLoaded 任せ
- レースコンディションの典型例。`window._workspacesReady` 等の既存ゲートを尊重する設計が必要

---

## 5. Group 4〜5 で残っている実装

### Group 4: 設定画面に「アンロック機能一覧」新設(実績見積 1〜1.5h)
- 自動エクスポート(全プラン対応)+ 将来枠(プラン制限機能はアップグレードCTA)
- 「設定を開く」ボタン → WS編集モーダルの自動エクスポートセクションへスクロールジャンプ
  - 実装: WS編集モーダルの自動エクスポートセクションに `id="auto-export-section"` を付与
  - `openWorkspaceEditModal(currentWsId, { scrollTo: 'auto-export-section' })`
  - `scrollIntoView({ behavior: 'smooth' })`
- 設計思想「ユーザーが自分で開放する」と整合

### Group 5: エクスポート履歴 + 通知 + 500件バッチ分割(実績見積 1.5〜2h)
- サイドバーに「エクスポート履歴」追加
- アプリ内通知(エクスポート完了/失敗)
- 失敗通知メール
- **500件バッチ分割**:
  - `executeAutoExport()` で未エクスポート仕訳を取得する際、500件ずつバッチに分割
  - 500件超のケース: 1トリガーで複数CSV生成(`_part1.csv` / `_part2.csv` ...)
  - shiwake_exports に1行ずつ記録(全バッチ成功で初めて `exported_at` 更新)
  - メール本文に「Nファイルに分割して送信」と明記
  - 通常運用(threshold=30)では発生しない、配送失敗が続いた場合の安全弁

---

## 6. v2.4.0 完走後の独立タスク

### サイドバー再構成「入口→処理→出口」(Group 5 直後に実施)

**現状の問題**: サイドバーが10項目近くまで増え、新機能追加で煩雑になる

**グループ案**(名称は実装時に再検討):
```
[受け取る]
  スキャン / 自動取り込み / 未振り分け

[仕訳する]
  仕訳処理 / 仕訳ルール学習

[送り出す]
  CSV統合・変換 / エクスポート履歴(v2.4.0)

[運用]
  スタッフ管理

[開発者向け]
  通常表示に切替 / キャッシュ統計
```

**実装方針**:
- 各グループ見出しは折りたたみ可能(クリックで開閉、状態を localStorage に保存)
- デフォルトは全部展開(初見ユーザーが機能を見落とさないため)
- 既存のメニュー項目の ID やハンドラはそのまま、HTML の親要素だけグループ化

---

## 7. 戦略議論サマリ(v2.3.4 引き継ぎメモにも追記済み)

### 7-1. スマホ撮影モード構想
- **採用**: v2.4.0 完走 → カウントアップ追従バッジ後に投入
- 実績見積: 2〜4h

### 7-2. 楽楽精算比較 → 別領域、住み分け一択
- 楽楽精算 = 経費精算ワークフロー
- shiwake-ai = 仕訳生成エンジン
- 競合せず、棲み分けが正しい

### 7-3. 経理全般拡張余地
- **縦に深める**: 月次試算表 / 勘定科目ダッシュボード / 通帳突合 など → OK
- **横に広げない**: 請求書発行 / 給与 / 申告書 などは禁忌(税理士の領分を侵食する)

### 7-4. カウントアップ追従バッジ
- **B案採用**: スクロール追従ピル
- A案(sticky1行)却下、理由: ステップバー情報のダブり

### 7-5. v2.4.x 範囲の追加方針(2026-05-13 確定)
- **CSV出力上限**: 500件、超えたら複数CSV分割(Group 5)
- **アンロック詳細導線**: C案採用(アンロック機能一覧→WS編集モーダル自動エクスポートセクションへスクロールジャンプ)
- **サイドバー再構成**: Group 5 直後に独立タスク

---

## 8. DSK の作業習慣・好み(必読)

### 8-1. 体制
- **Claude(私)= 指示出し役**(たまにコードも書くかも)
- **Claude Code = 実装役**
- Claude Code には CLAUDE.md でも引き継ぎ済み

### 8-2. トークン節約
- 作業開始前に承認を得る(コードを書くなど作業でトークンを多く使う場合)
- 返答が長すぎないように、簡潔に
- 似たような質問の繰り返しを避け、しっかり考えて早とちり禁止
- 5回セルフチェックして送信

### 8-3. 先回り禁止のルール
- 1ターンに2つのことを言わない(1つは自由)
- 次タスクの依頼文・コード・SQL を「先出し」しない
- 1ターンに「現タスクの判定」+「次タスクの依頼文」を同時に出さない
- 現タスクの依頼文を出すのは1ターンに1つだけ
- 例外: DSK が明示的に「まとめて出して」「先出しして」と言った場合のみ
- 理由: 並行で出されるとトークンが無駄、判定と次着手がズレて混乱する

### 8-4. 色分けルール(出力フォーマット)

| マーク | 意味 |
|---|---|
| 🟦 **【Claude Code へ】** | Claude Code に貼り付ける依頼文 |
| 🟧 **【Supabase SQL Editor へ】** | Supabase SQL Editor で実行する SQL |
| 🟩 **【ブラウザコンソールへ】** | F12 のコンソールで実行する JS |
| 🟪 **【ターミナルへ】** | bash コマンド |

複数の実行先がある場合は、それぞれにマークを付ける。

### 8-5. 作業時間の見積もりルール
- 設計書記載の見積もりはそのまま使わず、**実績ベース(30〜40倍速)** で再算出
  - 設計書「1日」≒ 実績「30〜45分」
  - 設計書「1週間」≒ 実績「3〜5時間」
  - 設計書「2〜3週間」≒ 実績「6〜10時間」
- 設計書値と実績見積を並記(例:「設計書1週間 → 実績3〜5時間」)
- 作業可能時間とのマッチング確認してから着手
- 後方互換改修は標準より時間がかかる
- バグ発生時は +30〜60分の余裕を見る
- Claude Code が想定外動作した場合の時間ロス可能性も明記

**実績の根拠**: v2.3.1(設計書3〜4週間)を実績約6時間で完了(2026-05-11)。Claude(指示出し)+ Claude Code(実装)の並行作業による効果。

### 8-6. 進捗・工程把握の見せ方ルール(2段アコーディオン)
プロジェクトの進捗状況や工程を確認する系の問いには、常に **2段アコーディオン構造** で答える:
- 第1段(ピル/バッジ): 現在地のサマリーのみ表示、クリック可能とわかる形
- 第2段(クリックで展開): 全工程の詳細マップ(SVG等の図解)が出る
- 確認後は再度クリックで収納できる
- 実装手段: Visualizer の interactive モジュール(HTML widget + aria-expanded + max-height transition)
- トリガー例:「今どこ?」「全工程の確認」「進捗教えて」「どの辺まで進んだ?」「ロードマップは?」「全体のどの辺?」
- shiwake-ai に限らず、他プロジェクトでも適用

---

## 9. ファイルパス参照

### プロジェクトファイル
- `~/APP/shiwake-ai/`(プロジェクトルート)
- `~/APP/shiwake-ai/index.html`(フロント)
- `~/APP/shiwake-ai/server.js`(サーバ)
- `~/APP/shiwake-ai/CLAUDE.md`(CC 指示書)

### ドキュメント
- `~/APP/shiwake-ai/docs/shiwake-ai_引き継ぎ_v2_3_4.md`
- `~/APP/shiwake-ai/docs/shiwake-ai_引き継ぎ_v2_3_5.md`(コミット 4e039ec)
- `~/APP/shiwake-ai/docs/shiwake-ai_v2_4_0_実装メモ.md`(Group 1〜2 + v2.4.x 追加方針)
- `~/APP/shiwake-ai/docs/shiwake-ai_戦略引き継き_メモ_2026-05-10.md`

### SQL マイグレーション
- `~/APP/shiwake-ai/sql/v2_3_5_unassigned_tray.sql`
- `~/APP/shiwake-ai/sql/v2_3_5_test_data.sql`
- `~/APP/shiwake-ai/sql/v2_4_0_auto_export.sql`
- `~/APP/shiwake-ai/sql/v2_4_1_yayoi_split.sql`(Group 2 修正で新規)

---

## 10. 未確認の動作テスト一覧

Group 3〜5 完了後にまとめて実施するもの:

- [ ] cloud destination(Dropbox / GDrive 配送)
- [ ] local destination(ローカルDL通知 + Supabase Storage アップロード)
- [ ] threshold デフォルト 30 の発火タイミング(本番運用シミュレーション)
- [ ] output_unit='merged'(WS統合モード、複数WSを1ファイルに)
- [ ] 失敗時のリトライ挙動(未エクスポート仕訳の次回トリガー引き継ぎ、設計 Q6=C)
- [ ] **(Group 2 修正後)** 弥生 .txt 拡張子 + 貸方科目別分割の動作確認
- [ ] **(Group 5 実装後)** 500件超バッチ分割の動作確認

---

## 11. 新チャットでの初手

新チャットでは、まず以下を確認:

1. このファイルを読み込み、現在地を把握
2. CC の Group 2 修正完了報告(`git log origin/main -1` 出力)を確認
3. DSK に動作確認用 SQL を提示(`auto_export_yayoi_split_mode = 'by_credit_account'`)
4. ブラウザで弥生形式 + 分割の動作確認
5. 完了 → Group 4 に着手 or 一旦休憩判断

**今のチャットは「Group 2 修正の完了報告待ち」で終了する想定**。次チャットの最初に完了報告を受ける形でスムーズに引き継げる。

---

> 最終更新: 2026-05-13 / DSK + Claude(Opus 4.7) 共同作成
