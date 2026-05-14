# shiwake-ai 引き継ぎ情報 v2.6.0

> **v2.6.0 の位置づけ**: v2.5.0 Phase 3(自動ルール学習)以降の差分を記録。
>
> 本セッションで **v2.6.0 Phase 4 を完走**:
> - **Phase 4**: 自動承認 — 信頼度メーターUI・自動承認ゲート・自動承認ログ・差し戻しトレイ、すべて実機テスト完了
> - **信頼度メーターの分母可変方式への再設計** — 「30件試して何件納得いったか」を測る装置に作り変え
>
> Phase 4 は「AIに承認まで任せられる範囲を、ユーザー自身が信頼度で解放していく」機能。設計思想「何をどう判断させるかを明確に見せる」を、信頼度メーターという可視化装置で体現したマイルストーン。実機テストで多数のバグ(特に `/api/trust-metrics` の rookie ロジック残存)を解決し、信頼度が承認ごとに正確に上昇することを確認済み。

---

## 1. エグゼクティブサマリ

| 項目 | 内容 |
|---|---|
| 完了タスク | v2.6.0 Phase 4(自動承認) + 信頼度メーター分母可変化 |
| 中核機能 | 信頼度メーター — 承認実績から信頼度を算出し、自動承認できる範囲を段階解放 |
| 信頼度の定義 | 修正なし承認件数 ÷ 分母(WS設定・デフォルト30) × 100、99%キャップ |
| 自動承認ゲート | 信頼度80%で「学習済みパターン自動承認」、95%で「全件自動承認」を解放 |
| 新規テーブル列 | `workspaces` に9列、`shiwake_records` に4列 + `status` 列 |
| 新規API | 自動承認系7本(toggle/reset/resume/log + revert/reverted-records/re-approve)、`/api/trust-metrics` 改修、`PATCH /api/workspaces/:id` に `trust_denominator` |
| 新規DB関数 | `calc_trust_metrics`(4引数版・分母方式) |
| 新規画面 | 自動承認ログ画面、差し戻しトレイ画面 |
| 重要な設計判断 | 信頼度メーターは「精度率」ではなく「分母に対する達成率」。1/1で100%にしない |
| 実機テスト | 承認のたびに信頼度が正確に上昇(3.3%→6.7%→10.0%)を確認 |
| **要対応の宿題** | **テスト用に変更した `users.edition` は NULL に戻し済み。次回テスト時は再度 `agent` に変更が必要** |
| バージョン位置 | v2.6.0 Phase 4 完成。残りはUI微調整(エクスポート履歴折りたたみ等)のみ |

---

## 2. コミット履歴(本セッション主要分)

```
（信頼度メーター分母可変化）
b89b147   信頼度メーター 分母可変対応 - recalculate/trust-metrics/WS設定 (server.js)
（index.html 第3段）  信頼度メーター 分母可変フロント対応 - rookie_layout廃止/分母セレクタ/再承認後の再取得
（解放済みバッジ修正）  信頼度メーター リセット後のrecent再計算修正 + 分母セレクタを装置内に移動
0289f0c   残骸ボタン非表示化 + 手動/自動承認後に信頼度メーター更新
（本命バグ修正）  /api/trust-metrics のrookie/insufficient_data分岐を廃止し常に実値を返す
0355481   信頼度メーター関連の適用済みSQLをリポジトリに追加（git追跡漏れの修正）
c10dc29   Phase 4 セッション引き継ぎメモ追加
```

> 注: Phase 4 本体(DB結線・7エンドポイント・信頼度メーター装置UI 等)のコミットハッシュは本ドキュメントに未記載。
> 正確なハッシュは `git log origin/main` で確認すること。

---

## 3. v2.6.0 Phase 4 実装内容: 自動承認

### 3.1 確定仕様(論点1〜5)

| # | 項目 | 確定内容 |
|---|---|---|
| 論点1 | 装置 | 「信頼度メーター」(中の見出し=「自動承認の設定」)。2段アコーディオン、デフォルト折りたたみ |
| 論点2 | 判定基準 | 信頼度ゲート2段階。**学習済みパターン自動承認=80%で解放／全件自動承認=95%で解放** |
| 論点3 | 初期状態 | 初期OFF(解放されても自分でON)。条件未達ONも可(確認ダイアログで警告) |
| 論点4 | 異常時 | 信頼度が閾値を割ったら自動承認を一旦停止(`auto_approve_paused_at`)→「続けるか」確認→再開はユーザー判断 |
| 論点5 | リセット | 非破壊(`trust_reset_at` 基準日リセット、`shiwake_records` は消さない)・確認ダイアログ・トグル両方OFF |
| — | 履歴 | 専用「自動承認ログ」画面(適用ルール・日時・差し戻しボタン)。差し戻しは専用「差し戻しトレイ」画面で再承認 |
| — | 通知 | 自動承認停止等の重要イベントはメール + アプリ内 |
| — | プラン | Agentスタンダード以上限定 |

### 3.2 信頼度メーターの定義(重要な再設計)

**「精度率」ではなく「分母に対する達成率」**:

- 信頼度 = 修正なし承認件数 ÷ 分母 × 100、99%キャップ
- 分子 = `status != 'reverted'` かつ `was_modified = false` の承認件数
- 分母 = WSごとに設定(`trust_denominator`、デフォルト30、選択肢30/50/100)
- **「30件試して何件納得いったか」を測る。** 1件目が正しくても 1/1=100% にはせず、1/30=3.3% とする
- 30件未満でも実際の%を表示(「データ蓄積中」「精度レポート」概念は廃止)
- 0件のとき `calc_trust_metrics` は `trust_score=null` を返し、フロントは「0.0%」と表示

### 3.3 DB構造(Supabase 実行済み)

**`workspaces` 追加列(計9列)**

| カラム | 型 | 内容 |
|---|---|---|
| auto_approve_learned_enabled | bool | 学習済みパターン自動承認 ON/OFF |
| auto_approve_all_enabled | bool | 全件自動承認 ON/OFF |
| auto_approve_learned_unlocked_at | timestamptz | 学習済み解放日時 |
| auto_approve_all_unlocked_at | timestamptz | 全件解放日時 |
| trust_reset_at | timestamptz | 信頼度リセット基準日 |
| auto_approve_paused_at | timestamptz | 自動承認一旦停止日時 |
| trust_denominator | int(NOT NULL DEFAULT 30, CHECK >=1) | 信頼度の分母 |

**`shiwake_records` 追加列**

| カラム | 型 | 内容 |
|---|---|---|
| auto_approved | bool | 自動承認されたか |
| auto_approve_type | text | 自動承認の種別(learned/all) |
| applied_learned_rule_id | uuid | 適用された学習ルール |
| status | text(DEFAULT 'approved', CHECK) | 'approved' / 'reverted' / 're_approved' |

**`calc_trust_metrics` 関数(4引数版)**

```
calc_trust_metrics(p_workspace_id uuid, p_period text,
                   p_reset_at timestamptz DEFAULT NULL,
                   p_denominator integer DEFAULT 30)
```

- `trust_score = LEAST(99, v_unmodified::numeric / p_denominator * 100)`、データ0件時は NULL
- WHERE句: `status != 'reverted'` + `approved_at >= v_since`(period) + `(p_reset_at IS NULL OR approved_at >= p_reset_at)`(リセット)
- `field_accuracy` は従来通り「率」のまま(trust_score だけ分母方式)

### 3.4 server.js 主要実装

- `applyAutoApproveFlags()` / `notifyAutoApprovePaused()` / `recalculateTrustMetrics()` — 自動承認のコア結線。ゲート解放判定(recent信頼度 >= 80/95)、paused 判定
- `analyze-chunk` でフラグ付与、`approve` で auto_approve 系を受け取り
- 新規エンドポイント7本: `/api/auto-approve/toggle` `/reset` `/resume` `/log` + `/api/revert` `/api/reverted-records` `/api/reverted-records/re-approve`
- `GET /api/trust-metrics` — 常に `workspace_trust_metrics` の実値を返す(rookie/insufficient_data ロジックは廃止)
- `PATCH /api/workspaces/:id` — `trust_denominator` を受け取り保存 + 再計算

### 3.5 index.html 主要実装

- 信頼度メーター装置(`renderTrustDashboard` 全面改修) — 2段アコーディオン、トグル2つ、メーターバー(80%/95%マーカー)、確認ダイアログ、リセット、分母セレクタ
- 自動承認ログ画面、差し戻しトレイ画面(再承認モーダル)
- rookie_layout / getDashboardLayout を**廃止**(常に信頼度メーター装置を表示)
- `autoApproveNewItems()` — 自動承認の発火実装。内部で `approveGroup` を経由

---

## 4. デバッグで解決した問題の記録

Phase 4 実装後、実機テストで多数の問題が発覚。すべて解決済み。

| # | 問題 | 根本原因 | 修正 |
|---|---|---|---|
| 1 | 残骸の「仕訳を自動生成する」ボタンが処理中に出現 | `runBtn` が removeFile/「最初からやり直す」で表示後、処理開始時に非表示化されない | `drainQueue` 冒頭で `display:none` |
| 2 | 手動/自動承認後に信頼度メーターが更新されない | `approveGroup` 末尾に `loadTrustMetrics()` 呼び出しがない(サーバ側 `recalculateTrustMetrics` は正常) | `approveGroup` 末尾に `loadTrustMetrics()` 追加(`autoApproveNewItems` も経由するので両方に効く) |
| 3 | 信頼度0%でも解放済みバッジが出る | `recalculateTrustMetrics` の recent コールに `p_reset_at` 渡し漏れ → リセット前データ込みで高スコア → ゲート解放チェックが `unlocked_at` を再セット | recent コールに `p_reset_at` 追加 |
| 4 | **本命: 承認しても信頼度0.0%・rookie表示のまま** | `/api/trust-metrics` に廃止したはずの rookie/insufficient_data 分岐がサーバ側に残存(フロントだけ rookie 廃止していた) | `/api/trust-metrics` から rookie/insufficient_data/remaining_to_threshold/message 分岐を削除し、常に実値返却 |

### 4.1 実機テスト最終結果(信頼度メーター、すべて成功)

- ✅ 承認のたびに信頼度が正確に上昇: 1件→3.3%、2件→6.7%、3件→10.0%(`n/30×100` どおり)
- ✅ メーターバーも段階的に伸びる、「累計承認」「直近30日」も連動
- ✅ リセットで信頼度0%・累計0件に戻る(非破壊)
- ✅ 自動承認の発火・ログ記録・差し戻し・トレイ表示・再承認、すべて動作

### 4.2 調査の教訓(申し送り)

信頼度バグ(症状4)の調査で、確認SQLの誤読・誤設計(`created_at`/`approved_at` の取り違え、ソート順の見落とし、WSフィルタの確認漏れ)により大きく遠回りした。最終的に Networkタブの外形的事実と CC の全体精査で原因に着地。**次回からは、推測でSQLを小出しにせず、早い段階で「外形的な事実(Network・APIレスポンス)を取る」「CCに全体精査させる」に切り替える。**

---

## 5. ⚠️ 次セッション冒頭で確認する宿題

### 5.1 users.edition の状態

`easy.you.me@gmail.com` の `edition` は**現在 NULL**(本セッション終了時に戻し済み)。

- 次回 Phase 4 / 自動承認まわりをテストする場合は、再度 `agent` に変更が必要

🟧 **【Supabase SQL Editor へ】**(テスト再開時のみ)
```sql
UPDATE public.users SET edition = 'agent' WHERE email = 'easy.you.me@gmail.com';
-- テスト完了後は NULL に戻す
```

### 5.2 `shiwake_records.status` 列の作成SQLがリポジトリに無い

本番DBには `status` 列('approved'/'reverted'/'re_approved')があるが、それを作成したSQLファイルがリポジトリに記録されていない(直接DBに当てたまま)。次回どこかでファイル化して `sql/` に追加すると安全。

---

## 6. 残課題

### 6.1 UI微調整(要望済み・未着手)

- エクスポート履歴UIの折りたたみ化(履歴が長くなりすぎる)
- 畳んだ親サイドバーグループに、中のメニューのバッジ件数を集約表示

### 6.2 既知の小課題(将来検討)

- `.trust-rookie-*` のCSSクラス定義が index.html に残っている(デッドコード、使用箇所なし)。掃除は任意
- 10枚一括 + 全自動承認時に `loadTrustMetrics()` が最大10回呼ばれる(実害なし、debounce は別途検討)
- `workspace_trust_metrics.maturity_level` 列はDBに残っているが、自動承認ゲート判定には未使用(判定は%ベース)

### 6.3 次フェーズ(v2.7.0 以降)

- **経理全般拡張(縦深化)**: 証憑回収の催促・追跡、異常検知アラート。月次試算表 / 勘定科目ダッシュボード / 通帳明細突合 / 決算前チェック
  - 着手の好機の目安: v2.6.0完了後〜異常検知フェーズ。最有望は証憑回収の催促・追跡と異常検知アラート(専門性の拡張になる)
  - Agentは「集める・整える・気づく」、判断は税理士。給与計算・請求書発行・申告書作成は対象外
- **v3.0.0**: 真のエージェント化(会計ソフトAPI連携、能動的質問)

---

## 7. 作業ルール(継承)

### 7.1 体制
- **Claude(指示出し役)+ Claude Code(実装役)**
- 独立タスクは並行CC運用OK。モニタリング表方式(タブ/案/状態/進捗)で毎ターン可視化

### 7.2 色マーク
| マーク | 意味 |
|---|---|
| 🟦 【Claude Code へ】 | Claude Code に貼り付ける依頼文 |
| 🟧 【Supabase SQL Editor へ】 | Supabase SQL Editor で実行する SQL |
| 🟩 【ブラウザコンソールへ】 | F12 のコンソールで実行する JS |
| 🟪 【ターミナルへ】 | bash コマンド |

### 7.3 先回り禁止
- 1ターン1依頼、現タスク完了 → 完了報告確認 → 次タスク
- 例外: 並行CC運用の依頼文を同時提示する場合のみ

### 7.4 その他
- トークン節約: コードを書く等トークンを多く使う作業は開始前に承認を得る
- 返答は簡潔に。早とちり禁止
- 作業見積は実績ベース(設計書比 30〜40倍速)
- 進捗確認系の問いは 2段アコーディオン構造(Visualizer interactive)
- DSK は「ボタンで押したい」志向 → `ask_user_input_v0` を積極活用。UI関連は視覚モックを先に提示
- バグ調査は早めに外形的事実(Network/APIレスポンス)を取る・CCに全体精査させる(本セッションの教訓)

---

## 8. ファイル参照・環境

### プロジェクトファイル
- `~/APP/shiwake-ai/`(プロジェクトルート)
- `~/APP/shiwake-ai/index.html`(フロント)
- `~/APP/shiwake-ai/server.js`(サーバ)
- `~/APP/shiwake-ai/CLAUDE.md`(CC 指示書)
- `~/APP/shiwake-ai/sql/`(マイグレーションSQL)

### ドキュメント
- `~/APP/shiwake-ai/docs/shiwake-ai_引き継ぎ_v2_5_0.md`(前バージョン)
- `~/APP/shiwake-ai/docs/shiwake-ai_セッション引き継ぎ_2026-05-14.md`(本セッションの軽量メモ)
- `~/APP/shiwake-ai/docs/shiwake-ai_引き継ぎ_v2_6_0.md`(**本ドキュメント**)

### 環境
- 本番: shiwake-ai.com(Render 自動デプロイ)
- GitHub: nice-gecko/shiwake-ai
- Supabase Project ID: `tmddairlgpyinqfekkfg`
- DSK Firebase UID / users.id: `6eZXyCx56ccpL2K4dYlUiYhrmbc2`
- DSK email: easy.you.me@gmail.com
- DSK デフォルト WS ID: `c26abe55-f82d-45f5-b393-b01453418c45`

---

## 9. 新チャットでの初手手順

1. 本ドキュメントを読み込み、現在地を把握
2. `git log origin/main -8` で最新コミット確認
3. §5 の宿題(`users.edition` の状態、`status` 列SQLのファイル化)を確認
4. §6「残課題」を DSK に提示(UI微調整を進めるか、次フェーズ=経理縦深化に進むか)
5. DSK の選択に従ってタスク開始

---

**v2.6.0 は、自動承認(Phase 4)という「AIに承認まで任せられる範囲を、ユーザー自身が信頼度で解放していく」機能が、実機動作を達成したマイルストーン。** 信頼度メーターを「精度率」ではなく「分母に対する達成率」として再設計し、設計思想「何をどう判断させるかを明確に見せる」を可視化装置として体現した。次は経理全般の縦深化(証憑回収・異常検知)へ進む段階。
