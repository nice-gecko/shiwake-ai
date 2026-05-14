# shiwake-ai 引き継ぎ情報 v2.5.0

> **v2.5.0 の位置づけ**: v2.4.8(サイドバー再構成)以降の差分を記録。
>
> 本セッションで **v2.4.9 → v2.5.0 Phase 3** を完走:
> - **v2.4.9**: 料金プランボタンを「設定」グループ配下にも追加(C案=フッター+設定の両方)、タブ切替パカパカ問題修正
> - **v2.5.0 Phase 3**: 自動ルール学習(中核機能)— 検出・保存・表示・適用すべて実機テスト完了
>
> Phase 3 は「ユーザーが自分専用ツールを育てている感覚」を中核機能として実装した最重要マイルストーン。
> 多数のデバッグ(カラム名typo・処理順序・金額按分)を経て、ゴディバ領収書での実機テストに全項目成功。

---

## 1. エグゼクティブサマリ

| 項目 | 内容 |
|---|---|
| 完了タスク | v2.4.9(料金プラン位置 + パカパカ修正)、v2.5.0 Phase 3(自動ルール学習) |
| 中核機能 | 自動ルール学習 — 取引先+キーワードから借方科目を完全自動学習・自動適用 |
| 新規テーブル | `learned_rules`(conditions JSONB / result JSONB) |
| workspaces 追加列 | `auto_rule_learning_enabled` / `auto_rule_strictness` / `auto_rule_unlocked_at` |
| 新規API | `GET/PATCH/DELETE /api/learned-rules` |
| 重要な設計判断 | 処理順序を「マスタ→ルール→ハッシュ→AI」に変更(ユーザー検証済みを優先) |
| 実機テスト | ゴディバ領収書でルール適用 + 金額按分 両方成功 |
| **要対応の宿題** | **テスト用に変更した `users.edition` を NULL に戻す**(§6 参照) |
| バージョン位置 | v2.5.0 Phase 3 中核完成。残りは任意の軽量テストのみ |

---

## 2. コミット履歴(本セッション主要分)

```
（v2.4.9）  料金プランボタンを設定グループ配下にも追加(C案)
6e6a149    タブ切替パカパカ修正(.master-table table-layout:fixed + .main width:min)
（v2.5.0 Phase 3 本体）
  Step1    DBマイグレーション(learned_rules + workspaces 3列追加)
  Step2    server.js — 検出ロジック・適用ロジック・新API
  Step3    index.html — 自動学習ルールタブUI・WS設定ポリシーセクション
（v2.5.0 hotfix 群）
481392c    0件表示 hotfix(GET /api/learned-rules の SELECT カラム名修正)
25e0281    OFFバッジ + 重複登録 hotfix(workspaces レスポンスマップ漏れ + 排他制御)
c20434d    keywords空ルール除外
（処理順序変更）  仕訳生成を マスタ→ルール→ハッシュ→AI に変更
209d831    学習ルール適用の SELECT カラム名typo + result ネストアクセス漏れ修正
（金額按分）  税抜内訳を税込合計に合わせて按分変換(金額ずれ修正)
```

> 注: Step1〜3 本体および一部 hotfix のコミットハッシュは本ドキュメントに未記載。
> 正確なハッシュは `git log origin/main` で確認すること。

---

## 3. v2.4.9 実装内容

### 3.1 料金プランボタンの位置(C案採用)

- v2.4.8 ではフッター位置のみだったが、4グループUIで見つけにくい問題
- **C案**: フッター(`navPlanFooter`)+「設定」グループ配下(`navPlanInSettings`)の**両方**に表示
- switchTab で両方に active 連動

### 3.2 タブ切替パカパカ問題修正(コミット 6e6a149)

- **症状**: 3タブ(取引先マスタ/カテゴリルール/自動学習ルール)切替で画面幅が変動
- **根本原因**: `.master-table` が `table-layout:auto` で `width:100%` を無視し `.main` を押し広げていた
- **修正(案A+C)**:
  - `.master-table` に `table-layout:fixed` を追加
  - `.main` を `max-width:680px` → `width:min(680px,100%)` に変更
- 実機確認で「パカパカ停止 + 列幅OK」

---

## 4. v2.5.0 Phase 3 実装内容: 自動ルール学習(中核機能)

### 4.1 確定仕様(D-1〜D-8b)

| # | 項目 | 確定内容 |
|---|---|---|
| D-1 | 設置場所 | 既存「仕訳ルール学習」画面に「自動学習ルール」タブとして統合 |
| D-2 | 学習対象 | **取引先 + 説明文キーワード → 借方科目** |
| D-3 | 検出トリガー | N件貯まったらイベント駆動(Cron不要)。※実装では `auto_rule_learning_enabled` のみで毎回発火。`% 10` 判定は未実装だがテスト上問題なし(排他制御で重複INSERT防止済み) |
| D-4+D-5 | 運用方針 | **完全自動学習・自動適用・異常時のみ通知**(承認モーダルなし)。設計思想「手放しで運用」を反映 |
| D-6 | 提供範囲 | Agent版以上限定 + 即アンロック(WS設定で自分でON、初期OFF) |
| D-7 | データ構造 | `learned_rules` テーブル新設(conditions JSONB / result JSONB) |
| D-8 | 異常検知 | 推奨閾値(矛盾即フラグ、適用5回以上で修正率30%超フラグ) |
| D-8b | 厳しさ設定 | WS設定に strict / balanced / loose のセレクタ |

### 4.2 DB構造(Supabase 実行済み)

**`learned_rules` テーブル(新設)**

| カラム | 型 | 内容 |
|---|---|---|
| id | uuid | PK |
| workspace_id | uuid | WS紐付け |
| conditions | jsonb | `{partner_name, description_keywords[]}` |
| result | jsonb | `{debit_account, credit_account}` |
| applied_count | int | 適用回数 |
| last_applied_at | timestamp | 最終適用日時 |
| modified_after_apply_count | int | 適用後に修正された回数 |
| is_active | bool | 有効/無効 |
| anomaly_flag | bool | 異常検知フラグ |
| created_at / updated_at | timestamp | — |

**`workspaces` 追加3列**

- `auto_rule_learning_enabled`(bool、初期 false)
- `auto_rule_strictness`(strict / balanced / loose)
- `auto_rule_unlocked_at`(timestamp)

### 4.3 server.js 主要実装

- `detectAndStoreRules()` — 検出ロジック。承認済み仕訳から「取引先+キーワード→借方科目」の頻出パターンを集計し learned_rules に保存。**Claude API は使わずローカル SQL のみ**
- `applyLearnedRule()` / `findLearnedRuleMatch()` — 適用ロジック。partner_name 一致 + keyword 部分一致で判定
- 新API: `GET/PATCH/DELETE /api/learned-rules`
- `_autoRuleRunning = new Set()` — WS単位の排他制御。非同期の重複起動による多重INSERTを防止

### 4.4 index.html 主要実装

- 「自動学習ルール」タブUI(3タブ目)— ステータスバー(ON/OFF + 学習件数)、ルール一覧、無効化/削除ボタン
- WS設定モーダルに「自動ルール学習ポリシー」セクション(ON/OFFトグル + 厳しさセレクタ)
- approveGroup / approve に rule_id 連携

### 4.5 重要な設計判断: 処理順序の変更

**変更前**: ハッシュキャッシュ → 取引先マスタ → 学習ルール → AI
**変更後**: **取引先マスタ → 学習ルール → ハッシュキャッシュ → AI**

理由:
- ハッシュキャッシュ = 過去のAI判定結果(ユーザー未検証)
- 学習ルール・取引先マスタ = ユーザーが承認・修正したパターン(検証済み)
- 旧順序だと「ルールで直してもハッシュキャッシュの古い結果が出続ける」事故が発生
- ハッシュキャッシュの本来の目的(AI再呼び出し防止 = コスト削減)は AI の手前にあれば達成できる
- **判断: 正解**。ゴディバ実機テストで学習ルールが正しく優先適用された

---

## 5. デバッグで解決した問題の記録

Phase 3 実装後、実機テストで多数の問題が発覚。すべて解決済み。

| # | 問題 | 根本原因 | 修正 |
|---|---|---|---|
| 1 | edition判定でセクションが出ない | テスト用SQLで `edition='agent_lite'` を入れたのが誤り。`edition` には `agent` か `elite` のみ。`agent_lite` 等は plan_key | `UPDATE users SET edition='agent'` で対応(テスト後 NULL に戻す宿題) |
| 2 | ルール0件表示(481392c) | `GET /api/learned-rules` の SELECT が存在しないカラム名指定 → 400 → 500 → フロント空配列 | `conditions,result,is_active` に修正 |
| 3 | OFFバッジ誤表示(25e0281) | `/api/workspaces` レスポンスマップで `auto_rule_learning_enabled` が脱落 → フロント undefined | マップに追加 |
| 4 | 「重複登録」誤認(25e0281→c20434d) | 実は description_keywords が異なる別ルール(空[]版とキーワード付き版が両方できていた) | `detectAndStoreRules` で keywords 空の候補をスキップ。既存の空ルールは SQL で削除 → 2件にクリーン化 |
| 5 | ルール未適用(209d831) | ① SELECT カラム名typo(partner_name 等)② result ネストアクセス漏れ(`learnedMatch.debit_account` → `learnedMatch.result?.debit_account`) | server.js:2487 / 2511 / 2624-2625 修正 |
| 6 | 金額ずれ ¥5,217→¥4,830 | 税抜内訳(¥30+¥4,800)を税込合計(¥5,217)と一致させずそのまま使用。SYSTEMプロンプトの「内訳行優先」が register_receipt の「合計優先」を上書き | 案A採用 = 合計行を正として税率按分。プロンプト3箇所修正(SYSTEM L1220-1249 / register_receipt L1260 / total_only L1387)。端数=四捨五入+差額は最大金額行で調整+2円以内は変換不要 |

### 5.1 実機テスト最終結果(ゴディバ領収書 ¥5,217、すべて成功)

- ✅ **ルール適用**: `debit:交際費`、`learnedRuleApplied:true`、`learnedRuleId:d0b9d980-2cec-4014-b09b-8433e084920a`
- ✅ **金額按分**: 「課税仕入(10%) ¥33」「課税仕入(8%軽減) ¥5,184」、合計 ¥5,217 で一致
- ✅ ステータスバー「ON / 学習件数: 2件」
- learned_rules は現在2件(ゴディバ→交際費 / ローソン→租税公課、どちらもキーワード付き)

---

## 6. ⚠️ 次セッション冒頭で必ず対応する宿題

### 6.1 users.edition を元に戻す(最優先)

テスト用に `easy.you.me@gmail.com` の `edition` を `agent` に変更したまま。**元の値は NULL**。

🟧 **【Supabase SQL Editor へ】**
```sql
UPDATE public.users SET edition = NULL WHERE email = 'easy.you.me@gmail.com';
```

> ※もし「次セッションでも引き続き自動ルール学習をテストする」場合は、戻すのを後回しにしてもよい。
> ただし放置すると DSK アカウントが Agent 版扱いのままになるので、テスト完了次第すぐ戻すこと。

---

## 7. 残課題

### 7.1 v2.5.0 範囲内(任意・軽量テスト、未実施)

- 「自動学習ルール」画面で適用回数カウントアップの確認(ゴディバが「適用2回」になっているか)
- 無効化ボタン: ルール無効化 → 再アップロードで AI判定に戻るか
- 削除ボタン: 削除 → リストから消えるか
- 矛盾検知: 同条件で別科目を承認 → `anomaly_flag` が立つか

### 7.2 既知の小課題(将来検討)

- **D-3 検出トリガー**: 仕様は「`% 10` イベント駆動」だが実装は「毎回発火」。現状は排他制御(`_autoRuleRunning` Set)で重複INSERT防止済み。将来 `% 10` にするか要検討
- **金額按分のAI依存リスク**: 「税率単一の税抜内訳」パターンは AI が税抜と正しく判定できれば変換されるが、判断がAI依存(中リスク)。案Aの宿命として許容

### 7.3 次フェーズ(v2.6.0 以降)

- **v2.6.0 Phase 4**: 自動承認(エージェント対応)
- **v3.0.0**: 真のエージェント化(会計ソフトAPI連携、能動的質問)
- **経理全般拡張(縦深化)**: 証憑回収の催促・追跡、異常検知アラート。月次試算表 / 勘定科目ダッシュボード / 通帳明細突合 / 決算前チェック
  - 着手の好機の目安: v2.4.0完了後〜異常検知フェーズ。最有望は証憑回収の催促・追跡と異常検知アラート(専門性の拡張になる)

---

## 8. 作業ルール(継承)

### 8.1 体制
- **Claude(指示出し役)+ Claude Code(実装役)**
- 独立タスクは並行CC運用OK。モニタリング表方式(タブ/案/状態/進捗)で毎ターン可視化

### 8.2 色マーク
| マーク | 意味 |
|---|---|
| 🟦 【Claude Code へ】 | Claude Code に貼り付ける依頼文 |
| 🟧 【Supabase SQL Editor へ】 | Supabase SQL Editor で実行する SQL |
| 🟩 【ブラウザコンソールへ】 | F12 のコンソールで実行する JS |
| 🟪 【ターミナルへ】 | bash コマンド |

### 8.3 先回り禁止
- 1ターン1依頼、現タスク完了 → 完了報告確認 → 次タスク
- 例外: 並行CC運用の依頼文を同時提示する場合のみ

### 8.4 その他
- トークン節約: コードを書く等トークンを多く使う作業は開始前に承認を得る
- 返答は簡潔に。早とちり禁止
- 作業見積は実績ベース(設計書比 30〜40倍速)
- 進捗確認系の問いは 2段アコーディオン構造(Visualizer interactive)
- DSK は「ボタンで押したい」志向 → `ask_user_input_v0` を積極活用。UI関連は視覚モックを先に提示

---

## 9. ファイル参照・環境

### プロジェクトファイル
- `~/APP/shiwake-ai/`(プロジェクトルート)
- `~/APP/shiwake-ai/index.html`(フロント)
- `~/APP/shiwake-ai/server.js`(サーバ)
- `~/APP/shiwake-ai/CLAUDE.md`(CC 指示書)

### ドキュメント
- `~/APP/shiwake-ai/docs/shiwake-ai_引き継ぎ_v2_4_8.md`(前セッション)
- `~/APP/shiwake-ai/docs/shiwake-ai_引き継ぎ_v2_5_0.md`(**本ドキュメント**)

### 環境
- 本番: shiwake-ai.com(Render 自動デプロイ)
- GitHub: nice-gecko/shiwake-ai
- Supabase Project ID: `tmddairlgpyinqfekkfg`
- DSK Firebase UID / users.id: `6eZXyCx56ccpL2K4dYlUiYhrmbc2`
- DSK email: easy.you.me@gmail.com
- DSK デフォルト WS ID: `c26abe55-f82d-45f5-b393-b01453418c45`

---

## 10. 新チャットでの初手手順

1. 本ドキュメントを読み込み、現在地を把握
2. **§6 の宿題(`users.edition` を NULL に戻す)を最優先で確認・対応**
3. `git log origin/main -8` で最新コミット確認
4. §7「残課題」を DSK に提示(任意の軽量テストを続けるか、次フェーズに進むか)
5. DSK の選択に従ってタスク開始

---

**v2.5.0 は、自動ルール学習(Phase 3)という「ユーザーが自分専用ツールを育てている感覚」の中核機能が、検出・保存・表示・適用のすべてで実機動作を達成した最重要マイルストーン。** 多数のデバッグを経て、処理順序を「ユーザー検証済み優先」に再設計し、金額按分の正確性も担保した。次は v2.6.0 Phase 4(自動承認)、あるいは経理全般の縦深化(証憑回収・異常検知)へ進む段階。
