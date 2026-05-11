# shiwake-ai 統合実装ロードマップ v3.1

> **本ドキュメントの位置づけ**
> 2026年5月10日改訂。前版 v3.0 は A-3b 初版を前提に書かれていたが、**仕訳記録の DB 保存基盤が存在しない**ことが判明し、A-3b は v2 に改訂された。本ロードマップも v3.1 として全面更新。
>
> 関連設計書(全7本):
> 1. `shiwake-ai_設計思想_v3_0.md`(北極星)
> 2. `shiwake-ai_UI言語置換マップ_v3_0.md`
> 3. `shiwake-ai_ワークスペース機能設計_v3_0_A3a.md`
> 4. ~~`shiwake-ai_信頼度メトリクス設計_v3_0_A3b.md`~~(初版、破棄)
> 5. `shiwake-ai_信頼度メトリクス設計_v3_0_A3b_v2.md`(改訂版)
> 6. `shiwake-ai_料金プラン拡張設計_v3_0_A3c.md`
> 7. `shiwake-ai_戦略引き継ぎメモ_2026-05-10.md`
>
> **ゴール**: v2.6.0(Phase 4 = 自動承認)まで完成、**兄(税理士)へのお披露目**。

---

## 📌 v3.1 の改訂サマリー(v3.0 から何が変わったか)

| 項目 | v3.0 | v3.1 |
|---|---|---|
| 信頼度メトリクスの前提 | shiwake_records 存在 | **新設が必要** |
| Phase v2.3.1 の範囲 | UI改訂+列追加 | **UI改訂+テーブル新設+保存基盤** |
| Phase v2.3.1 の期間 | 2〜3週間 | **3〜4週間** |
| session.js の扱い | 言及なし | **温存を明記** |
| 全体期間 | 3〜5ヶ月 | **3.5〜5.5ヶ月** |
| pr-agent 整理 | 未対応 | **2026-05-10 完了済み** |
| CLAUDE.md 整備 | 未対応 | **2026-05-10 完了済み** |

---

## 1. ゴール定義(兄お披露目時のチェックリスト)

### 1.1 機能完成度

#### 必須(MUST)
- [ ] **Phase 1**: 自動取り込み(メール/Dropbox/GDrive)動作
- [ ] **Phase 2**: 自動エクスポート動作
- [ ] **Phase 3**: 自動ルール学習動作
- [ ] **Phase 4**: 自動承認動作
- [ ] **ワークスペース機能**: 複数顧問先の分離管理
- [ ] **仕訳記録の永続化**: shiwake_records への保存(**新規追加項目**)
- [ ] **信頼度メトリクス**: 承認率・項目別精度・修正パターン表示
- [ ] **UI言語**: 成長物語語彙が完全削除、業務語彙に統一
- [ ] **料金プラン**: 28プラン(Stripe本番モード)登録済み
- [ ] **代理店制度**: Bronze/Silver/Gold が動作

#### あれば(SHOULD)
- [ ] 異常検知アラートの初期版
- [ ] 兄向けデモシナリオ(架空顧問先2社で全フロー触れる)
- [ ] 税理士向け説明資料

### 1.2 デモシナリオ(お披露目時)

v3.0 から変更なし(§7 参照)。

### 1.3 完成度の数値化

v3.0 から変更なし。

---

## 2. マイルストーン全体像

### 2.1 バージョン進行表

```
v2.3.0 ✅ 完了    ── 自動取り込み機能(コード上完成、実機未テスト)

v2.3.1 ⏳ START   ── 仕訳記録の永続化基盤 + UI改訂 + 信頼度メトリクス
                    (3〜4週間)

v2.3.2 ⏳         ── ワークスペース機能(マルチテナント)
                    (2〜3週間)

v2.3.3 ⏳         ── 料金プラン拡張(Stripe本番モード合流)
                    (1〜2週間)

v2.4.0 ⏳         ── Phase 2: 自動エクスポート
                    (2〜4週間)

v2.5.0 ⏳         ── Phase 3: 自動ルール学習
                    (2〜4週間)

v2.6.0 ⏳ GOAL    ── Phase 4: 自動承認 → 兄お披露目
                    (2〜4週間)
```

**合計**: 3.5〜5.5ヶ月

### 2.2 依存関係グラフ(v3.1で変更)

```
v2.3.1 (仕訳記録永続化 + UI改訂 + 信頼度メトリクス)
  │   ★shiwake_records テーブル新設が新規追加
  │   この上に全ての後続が乗る
  │
  ▼
v2.3.2 (ワークスペース機能)
  │   ★shiwake_records にも workspace_id を付与
  │   v2.3.1 で「default」ワークスペースで動作させ、
  │   ここで実 workspace_id に切り替え
  │
  ▼
v2.3.3 (料金プラン拡張)
  │
  ▼
v2.4.0 → v2.5.0 → v2.6.0
                       │
                       ▼
                  兄お披露目
```

### 2.3 v3.1 の重要な順序判断

**仕訳記録の DB 保存(v2.3.1)を、ワークスペース機能(v2.3.2)より先に実装する**。

理由:
- 信頼度メトリクスを動かすには、まず仕訳記録の保存が必要
- ワークスペース機能はマルチテナント化なので、保存基盤がある前提で「分離」する方が自然
- v2.3.1 ではいったん「default」ワークスペースID固定で動作させ、v2.3.2 で実 ID に切り替え

これにより、各フェーズで完結した動作が確認できる。

---

## 3. 「絶対に守ること」リスト(v3.0 から継承)

### 3.1 開発作業の鉄則

1. **DB変更前にバックアップ**(Free Plan のため自動バックアップなし、手動で確認)
2. **Stripe Dashboard 操作はテストモードで先に検証**
3. **各フェーズ末の動作確認チェックリストを全項目消化**
4. **設計書と実装の差異は、設計書を優先**
5. **既存機能を壊していないかの確認**

### 3.2 Claude Code に依頼する時の鉄則

6. **タスクを小さく切る**(ファイル単位、機能単位)
7. **「変更してはいけない箇所」を明示**
8. **設計書のセクション番号で参照**
9. **動作確認の合格条件を依頼時に渡す**
10. **diff(変更前/変更後)を要求**

### 3.3 v3.1 で追加した鉄則

11. **CLAUDE.md を参照**: `~/APP/shiwake-ai/CLAUDE.md` に作業指示書を配置済み(2026-05-10)。Claude Code はこれを参照する
12. **session.js は触らない**: 作業中バッファとして温存(改修・削除不要)
13. **pr-agent との取り違え禁止**: Supabase Project ID は `tmddairlgpyinqfekkfg`(shiwake-ai 本体)
14. **既存ユーザーは0人**: 大胆にマイグレーション可能、ただしリリース後はこの前提が変わる

---

## 4. フェーズ別実装計画

---

### Phase v2.3.1: 仕訳記録永続化 + UI改訂 + 信頼度メトリクス

#### 4.1.1 目的
- **仕訳記録の DB 保存基盤の新設**(本フェーズの最重要項目、v3.1 で追加)
- キャリアパス物語の完全廃止(顧客向け UI)
- 信頼度メトリクスの記録・計算・表示

#### 4.1.2 入力ドキュメント
- `shiwake-ai_設計思想_v3_0.md`(全体)
- `shiwake-ai_UI言語置換マップ_v3_0.md`(全28箇所の置換指示)
- `shiwake-ai_信頼度メトリクス設計_v3_0_A3b_v2.md`(全体、特に §2 〜 §5)

#### 4.1.3 タスク分解(v3.1 で大幅追加)

##### ▼ Group 1: DB変更(土台)

###### Task 1.1: shiwake_records テーブル新設
- **入力**: A-3b v2 §2.3 の SQL
- **対象**: Supabase Dashboard SQL Editor
- **作業**: テーブル作成、インデックス作成
- **動作確認**: `SELECT * FROM shiwake_records LIMIT 1;` がエラーなく実行できる
- **Claude Code 依頼**: 不要(手動で SQL editor 実行)

###### Task 1.2: workspace_trust_metrics テーブル新設
- **入力**: A-3b v2 §2.4 の SQL
- **動作確認**: SELECT エラーなし

###### Task 1.3: workspaces テーブル仮設(default 用)
v2.3.2 で本格的に作るが、v2.3.1 で「default」ワークスペースを動作させるため、最小限のテーブルを先に作る:

```sql
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_uid TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'マイワークスペース',
  is_default BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_workspaces_owner ON workspaces(owner_uid);
```

v2.3.2 で追加列(slug、is_archived、振り分けルール等)を ALTER TABLE で追加する。

###### Task 1.4: RPC関数 calc_trust_metrics 作成
- **入力**: A-3b v2 §4.4 の SQL
- **動作確認**: `SELECT calc_trust_metrics(<dummy_uuid>, 'all');` がエラーなく実行できる

##### ▼ Group 2: master.js 改修

###### Task 2.1: findMasterMatch() 戻り値拡張
- **入力**: A-3b v2 §8.4
- **対象**: `~/APP/shiwake-ai/master.js`
- **変更内容**: 戻り値を `{ matched_id, debit_account, method }` 形式に
- **変更禁止**: マッチング判定ロジック自体、loadMaster/saveMaster
- **Claude Code 依頼**: 後述テンプレート §6.1

##### ▼ Group 3: server.js 改修

###### Task 3.1: 新規ユーザーへの default ワークスペース自動作成
- **対象**: `server.js` `/api/user/upsert`(line 1067)
- **変更内容**: ユーザー作成時に default ワークスペースを自動作成、`current_workspace_id` をセット
- **Claude Code 依頼**: 後述テンプレート §6.2

###### Task 3.2: 既存ユーザーへの default ワークスペース自動付与(ログイン時)
- **対象**: `server.js`
- **変更内容**: GET /api/user で default ワークスペースが無ければ自動作成
- **Claude Code 依頼**: 後述テンプレート §6.3

###### Task 3.3: /api/shiwake/approve 新規エンドポイント
- **入力**: A-3b v2 §3.2
- **対象**: `server.js`
- **動作確認**: cURL で承認リクエスト → shiwake_records に1行 INSERT される
- **Claude Code 依頼**: 後述テンプレート §6.4

###### Task 3.4: recalculateTrustMetrics() 関数実装
- **入力**: A-3b v2 §4.5
- **対象**: `server.js`
- **Claude Code 依頼**: §6.4 と同時実行

###### Task 3.5: /api/trust-metrics 新規エンドポイント
- **入力**: A-3b v2 §5.2
- **対象**: `server.js`
- **動作確認**: ワークスペースの信頼度メトリクスが正しく返る
- **Claude Code 依頼**: 後述テンプレート §6.5

##### ▼ Group 4: index.html 改修(フロント)

###### Task 4.1: _aiProposed スナップショット保持
- **入力**: A-3b v2 §3.4
- **対象**: `index.html` addItems関数(line 3284付近)
- **変更内容**: 仕訳生成時に AI提案値を `_aiProposed` に保持
- **Claude Code 依頼**: 後述テンプレート §6.6

###### Task 4.2: approve() 関数で承認API呼び出し
- **入力**: A-3b v2 §3.3
- **対象**: `index.html` line 3704
- **変更内容**: 既存処理に加えて `/api/shiwake/approve` を呼ぶ
- **Claude Code 依頼**: 後述テンプレート §6.7

###### Task 4.3: 信頼度ダッシュボード実装(rookie/stable/mature の3UI)
- **入力**: A-3b v2 §6.1
- **対象**: `index.html`
- **変更内容**: 信頼度メトリクスを取得して状態別に表示
- **Claude Code 依頼**: 後述テンプレート §6.8

###### Task 4.4: 承認後の編集禁止
- **入力**: A-3b v2 §3.5
- **対象**: `index.html`
- **変更内容**: 承認済みカードの編集UIを無効化
- **Claude Code 依頼**: 後述テンプレート §6.9

##### ▼ Group 5: UI言語の置換(成長物語廃止)

###### Task 5.1: UI言語の全置換(index.html、28箇所)
- **入力**: `shiwake-ai_UI言語置換マップ_v3_0.md`(全体)
- **対象**: `index.html`
- **変更禁止**: G(維持)グループの箇所、Bronze/Silver/Gold語彙
- **Claude Code 依頼**: 後述テンプレート §6.10

###### Task 5.2: バージョン表記更新
- **対象**: `index.html` line 1265 付近
- **変更内容**: `v2.3.0 · Sonnet 4.6` → `v2.3.1 · Sonnet 4.6`

#### 4.1.4 並行作業の可否

依存関係:

```
Group 1 (DB) →┬→ Group 2 (master.js)
              ├→ Group 3 (server.js) → Group 4 (フロント)
              └→ Group 5 (UI言語、独立)
```

並行可能:
- Group 2 と Group 5(完全独立)
- Group 3 内の Task 3.1/3.2(別エンドポイント)

直列必須:
- Group 1 → Group 3
- Group 3 → Group 4(API完成後にフロント実装)

#### 4.1.5 フェーズ完了の合格条件

##### 仕訳記録の永続化
- [ ] `shiwake_records` テーブルに承認時にINSERTされる
- [ ] AI提案そのままで承認 → `was_modified=false`
- [ ] 借方科目を編集して承認 → `was_modified=true`, `modified_fields=['debit_account']`
- [ ] 複数項目編集 → 全て modified_fields に含まれる
- [ ] 承認後の編集が無効化されている

##### 信頼度メトリクス
- [ ] 承認イベント後、`workspace_trust_metrics` が更新される
- [ ] `/api/trust-metrics` が正しい値を返す
- [ ] 30件未満で `insufficient_data` 表示
- [ ] 50件以上で stable レイアウト
- [ ] 200件以上+承認率95%以上で mature レイアウト

##### UI言語
- [ ] 「ルーキー」「ジュニア」「卒業」「育成中」等が完全に削除
- [ ] 卒業モーダルが発火しない
- [ ] 「育成度⭐」が「学習取引先数 N社」に置換
- [ ] バージョン表記が v2.3.1

##### 既存機能の温存
- [ ] 仕訳生成が壊れていない(リグレッション確認)
- [ ] CSV出力が壊れていない
- [ ] 自動取り込み設定が壊れていない
- [ ] session.js のセッション管理が動作している
- [ ] **Stripe webhook が壊れていない**(プラン契約処理)

合格 → v2.3.2 に進む

---

### Phase v2.3.2: ワークスペース機能(マルチテナント基盤)

#### 4.2.1 目的
- 複数顧問先を1アカウントで管理するマルチテナント機能
- v2.3.1 で「default」ワークスペースとして動作していたものを、複数対応に拡張

#### 4.2.2 入力ドキュメント
- `shiwake-ai_ワークスペース機能設計_v3_0_A3a.md`(全体)

#### 4.2.3 タスク分解

A-3a §10.1 の Phase 1〜5 に従う。ただし v2.3.1 で先に作った部分は飛ばす:

- ~~`workspaces` テーブル作成~~ → v2.3.1 で最小版作成済み、ALTER TABLE で追加列を入れる
- ~~`shiwake_records` への workspace_id 列追加~~ → v2.3.1 で既に追加済み
- `inbox_files`、`inbox_addresses` 等への workspace_id 列追加 → **本フェーズで実施**
- マスタ・ハッシュキャッシュのワークスペース対応 → **本フェーズで実施**
- 新規 API(/api/workspaces 系) → **本フェーズで実施**
- フロント実装(切り替えセレクタ、管理画面) → **本フェーズで実施**
- メール振り分けロジック → **本フェーズで実施**

#### 4.2.4 フェーズ完了の合格条件

A-3a §10.3 の動作確認チェックリスト全12項目。

特に重要:
- [ ] **ハッシュキャッシュがワークスペースをまたがない**(セキュリティ最重要)
- [ ] WS切替で仕訳記録の表示が切り替わる
- [ ] WS切替で信頼度メトリクスが切り替わる(v2.3.1 で実装済み)

---

### Phase v2.3.3: 料金プラン拡張 + Stripe本番モード移行

#### 4.3.1 目的
- ワークスペース機能の有料化(28プランへ)
- Stripe本番モード移行(これまで保留分も合流)
- 代理店規約 v1.1 改定

#### 4.3.2 入力ドキュメント
- `shiwake-ai_料金プラン拡張設計_v3_0_A3c.md`(全体)

#### 4.3.3 タスク分解

A-3c §9.2 の Phase 1〜6 に従う(変更なし)。

#### 4.3.4 フェーズ完了の合格条件

A-3c §10.3 の動作確認チェックリスト17項目。

---

### Phase v2.4.0: Phase 2 自動エクスポート

#### 4.4.1 目的
- AI仕訳後、会計ソフト別CSVを自動で保存・通知

#### 4.4.2 着手時の注意
- 本フェーズ着手時に**Phase 2 詳細仕様書**を別途作成する
- ワークスペース別に動作することを確認

---

### Phase v2.5.0: Phase 3 自動ルール学習

#### 4.5.1 目的
- 繰り返しパターンの自動ルール化

#### 4.5.2 着手時の注意
- 本フェーズ着手時に**Phase 3 詳細仕様書**を別途作成
- 設計思想 §1.3「透明性」を体現

---

### Phase v2.6.0: Phase 4 自動承認 → 兄お披露目

#### 4.6.1 目的(最重要フェーズ)
- 信頼度の高い仕訳を確認なしで自動確定
- **兄に見せる完成品の最終形**

#### 4.6.2 入力ドキュメント
- `shiwake-ai_設計思想_v3_0.md` §5(自動化機能の独立トグル)
- `shiwake-ai_信頼度メトリクス設計_v3_0_A3b_v2.md` §8.5

#### 4.6.3 タスク分解(概要)

- 自動承認の判定ロジック(信頼度ベース)
- 自動承認設定UI(ワークスペース別)
- 「自動承認モード中」表示
- 信頼度低下時の自動OFF

#### 4.6.4 兄お披露目前の最終チェック

v3.0 §4.6.4 と同じ。45分のデモシナリオを完走できることが合格条件。

---

## 5. リスクと対策

v3.0 §5 から継承、追加項目あり。

### 5.1 技術的リスク

#### リスクT1: DB マイグレーションの失敗
**v3.1 追加**: Free Plan のため Supabase 自動バックアップなし。
- 対策: ALTER TABLE を1つずつ実行、失敗時のロールバック SQL を事前準備

#### リスクT2: Stripe webhook の冪等性破綻
v3.0 と同じ。

#### リスクT3: ハッシュキャッシュのワークスペース混在
v3.0 と同じ(最重要)。

#### リスクT4(v3.1 追加): shiwake_records への INSERT 失敗
- 影響: 承認したのに記録が残らない
- 対策:
  - 失敗時のリトライ機構(将来検討)
  - フロントUIは承認成功扱い(UX優先)
  - エラーログを出力して後で分析

### 5.2 スケジュールリスク

v3.0 と同じ。

### 5.3 Claude のミス対策

v3.0 と同じ。

---

## 6. Claude Code 依頼文テンプレート集(v3.1 で更新)

### 6.1 Task 2.1: master.js の findMasterMatch() 改修

```
以下のタスクをお願いします。

【目的】
master.js の findMasterMatch() 関数の戻り値を拡張する。

【設計書】
shiwake-ai_信頼度メトリクス設計_v3_0_A3b_v2.md の §8.4

【変更内容】
findMasterMatch() の戻り値を以下の形式に変更:
{
  matched_id: <マスタID または null>,
  debit_account: <借方科目 または null>,
  method: 'exact' | 'partial' | 'fuzzy' | null
}

【変更してはいけない箇所】
- loadMaster, saveMaster の関数シグネチャ
- ファイルパスのロジック(masters/master_<uid>.json)
- 既存のマッチング判定ロジック自体

【動作確認の合格条件】
1. 既存の呼び出し元が壊れない
2. 完全一致時に method='exact' が返る
3. 部分一致時に method='partial' が返る
4. ヒットなしで method=null が返る

【完了報告】
変更前後のdiffを示してください。動作確認の結果も報告してください。
```

### 6.2 Task 3.1: 新規ユーザーへの default ワークスペース作成

```
以下のタスクをお願いします。

【目的】
新規ユーザー登録時に default ワークスペースを自動作成する。

【設計書】
shiwake-ai_ワークスペース機能設計_v3_0_A3a.md の §3.3
shiwake-ai_信頼度メトリクス設計_v3_0_A3b_v2.md の §3.1

【対象ファイル】
server.js の /api/user/upsert エンドポイント(line 1067付近)

【変更内容】
新規ユーザー作成時:
1. workspaces テーブルに default ワークスペースを作成
   - owner_uid: 新規ユーザーの uid
   - name: 'マイワークスペース'
   - is_default: true
2. users テーブルに current_workspace_id をセット
   ※ users テーブルに current_workspace_id 列が必要(Task 3.2 で追加)

【変更してはいけない箇所】
- 既存のユーザー作成ロジック本体
- 認証(Firebase)関連

【動作確認の合格条件】
1. 新規ユーザー登録 → workspaces テーブルに1行 INSERT される
2. users.current_workspace_id がセットされる
3. 既存ユーザーの動作に影響なし

【完了報告】
変更前後のdiffを示してください。
```

### 6.3 Task 3.2: 既存ユーザーへの default ワークスペース付与

```
以下のタスクをお願いします。

【目的】
既存ユーザーが API を叩いた時、default ワークスペースが無ければ自動作成する。

【背景】
v2.3.1 リリース後、既存ユーザー(現状0人だが念のため)がログインしてきた際に、
default ワークスペースを自動生成する必要がある。

【設計書】
shiwake-ai_ワークスペース機能設計_v3_0_A3a.md の §3.2

【対象ファイル】
server.js

【変更内容】
1. users テーブルに current_workspace_id 列追加(ALTER TABLE)
2. GET /api/user で current_workspace_id が NULL の場合、default ワークスペースを作成してセット

【変更してはいけない箇所】
- 既存のユーザー取得ロジック本体
- レスポンス形式(current_workspace_id を追加するのみ)

【動作確認の合格条件】
1. 既存ユーザー(current_workspace_id=null)が GET /api/user → 自動作成される
2. すでに default ワークスペースがあるユーザーは再作成されない
3. レスポンスに current_workspace_id が含まれる

【完了報告】
変更前後のdiffを示してください。
```

### 6.4 Task 3.3-3.4: /api/shiwake/approve エンドポイント + recalculateTrustMetrics

```
以下のタスクをお願いします。

【目的】
仕訳承認時に shiwake_records へ永続保存し、信頼度メトリクスを再計算する。

【設計書】
shiwake-ai_信頼度メトリクス設計_v3_0_A3b_v2.md の §3.2、§4.5

【対象ファイル】
server.js

【変更内容】
1. /api/shiwake/approve エンドポイント新規追加
   - リクエストボディから AI提案値・確定値を取得
   - 差分計算(was_modified、modified_fields)
   - shiwake_records に INSERT
   - recalculateTrustMetrics() を非同期で呼ぶ(レスポンスは待たせない)
2. recalculateTrustMetrics(workspaceId) 関数を実装
   - RPC関数 calc_trust_metrics を 'recent' と 'all' で呼ぶ
   - workspace_trust_metrics テーブルに upsert

【変更してはいけない箇所】
- 既存のエンドポイント
- 認証ロジック
- session.js 関連(/api/session/* エンドポイント)

【動作確認の合格条件】
1. cURL で承認リクエスト → shiwake_records に1行 INSERT
2. AI提案そのまま承認 → was_modified=false
3. 編集して承認 → was_modified=true、modified_fields に該当項目
4. workspace_trust_metrics が更新される
5. ワークスペース所有者以外からのリクエストは 403

【完了報告】
変更前後のdiffを示してください。
動作確認は curl コマンドで実施結果を提示してください。
```

### 6.5 Task 3.5: /api/trust-metrics エンドポイント

```
以下のタスクをお願いします。

【目的】
信頼度メトリクスを取得するエンドポイントを実装する。

【設計書】
shiwake-ai_信頼度メトリクス設計_v3_0_A3b_v2.md の §5.2

【対象ファイル】
server.js

【変更内容】
GET /api/trust-metrics?uid=xxx&workspace_id=yyy
- workspace_trust_metrics から最新値を取得
- サンプル数が30未満の場合は insufficient_data ステータスで返す
- workspace_id 未指定なら users.current_workspace_id をフォールバック使用

【変更してはいけない箇所】
- 既存のエンドポイント

【動作確認の合格条件】
1. 30件未満で insufficient_data 返却
2. 30件以上で trust_score が数値で返る
3. 不正な workspace_id で 403
4. workspace_id 未指定でフォールバック動作

【完了報告】
変更前後のdiffを示してください。
```

### 6.6 Task 4.1: _aiProposed スナップショット保持

```
以下のタスクをお願いします。

【目的】
仕訳生成時にAI提案値をフロント側で保持する。

【設計書】
shiwake-ai_信頼度メトリクス設計_v3_0_A3b_v2.md の §3.4

【対象ファイル】
index.html

【変更内容】
addItems関数(line 3284付近)で、results.push する前に each item に _aiProposed を追加:
it._aiProposed = {
  debit_account: it.debit,
  credit_account: it.credit,
  tax_category: it.tax,
  memo: it.memo
};

【変更してはいけない箇所】
- 仕訳生成のロジック本体
- マスタヒット記録のロジック
- 既存の results 配列の他のプロパティ

【動作確認の合格条件】
1. 仕訳生成後、results[0]._aiProposed が保持されている
2. ユーザーが UI で編集しても _aiProposed は変わらない

【完了報告】
変更前後のdiffを示してください。
```

### 6.7 Task 4.2: approve() 関数の承認API呼び出し

```
以下のタスクをお願いします。

【目的】
仕訳承認時に /api/shiwake/approve を呼ぶ。

【設計書】
shiwake-ai_信頼度メトリクス設計_v3_0_A3b_v2.md の §3.3

【対象ファイル】
index.html(line 3704付近の approve 関数)

【変更内容】
既存処理(approved.add、autoLearn、syncSessionSave)はそのまま残し、
syncSessionSave の後に /api/shiwake/approve への fetch を追加。
リクエストボディは設計書 §3.3 を参照。

【変更してはいけない箇所】
- 既存の approve ロジック
- マスタ即時適用のロジック(同じ取引先の未承認カードへの反映)
- syncSessionSave の呼び出し

【特に重要】
- fetch が失敗してもユーザーUIは承認扱いにする(優先度: UX > データ完全性)
- エラーは console.warn で出すだけ、ユーザーには表示しない

【動作確認の合格条件】
1. 承認 → shiwake_records に1行 INSERT
2. ネットワーク切断時もUIは承認状態になる(エラー無視)
3. workspace_id は getCurrentWorkspaceId() で取得(v2.3.1 では default 固定)

【完了報告】
変更前後のdiffを示してください。
```

### 6.8 Task 4.3: 信頼度ダッシュボードUI

```
以下のタスクをお願いします。

【目的】
信頼度メトリクスのダッシュボードUIを実装する(3パターン)。

【設計書】
shiwake-ai_信頼度メトリクス設計_v3_0_A3b_v2.md の §6.1

【対象ファイル】
index.html

【変更内容】
1. /api/trust-metrics を呼んでメトリクスを取得する fetchTrustMetrics() 関数追加
2. メイン画面の上部に信頼度ダッシュボードのDOM追加
3. maturity_level に応じて3パターンの表示切替:
   - rookie: 進捗バー大きく(あと◯件で精度表示)
   - stable: コンパクト + クリックで詳細展開
   - mature: ヘッダーに小さく
4. 初回ロード時とWS切替時に再取得

【変更してはいけない箇所】
- 既存のサイドバー、ナビゲーション
- 仕訳処理本体のUI
- 卒業モーダルの場所(Task 5.1 で削除予定だが、本タスクでは触らない)

【動作確認の合格条件】
1. 0件のWSで「あと◯件で精度表示」が出る
2. 30件未満で「データ蓄積中」が出る
3. 50件超で stable レイアウト表示
4. 200件超+95%超で mature レイアウト
5. クリックで詳細展開・閉じる

【完了報告】
変更前後のdiffを示してください。スクリーンショットがあれば添付してください。
```

### 6.9 Task 4.4: 承認後の編集禁止

```
以下のタスクをお願いします。

【目的】
承認後の仕訳カードは編集UIを無効化する。

【設計書】
shiwake-ai_信頼度メトリクス設計_v3_0_A3b_v2.md の §3.5

【対象ファイル】
index.html

【変更内容】
仕訳カードのレンダリング時に approved.has(i) なら:
- 編集可能なinput/selectをreadonly化
- 編集ボタンを非表示

【変更してはいけない箇所】
- approve関数のロジック
- 承認解除(削除)のロジック

【動作確認の合格条件】
1. 未承認カードは編集可能
2. 承認後に編集できなくなる
3. 削除は承認後でも可能

【完了報告】
変更前後のdiffを示してください。
```

### 6.10 Task 5.1: UI言語の置換(28箇所)

```
以下のタスクをお願いします。

【目的】
index.html から成長物語語彙を完全削除し、業務語彙に置換する。

【設計書】
shiwake-ai_UI言語置換マップ_v3_0.md 全体

【対象ファイル】
index.html

【変更内容】
設計書 §3.4 置換対応表に従い、28箇所を5ステップ順で変更:
- Step 1: 削除系(Group A, B, F)
- Step 2: 文言修正(Group D, E-1)
- Step 3: ロジック書き換え(Group B-3, C-2)
- Step 4: 表示変更(Group E-2, E-3)
- Step 5: 動作確認

【変更してはいけない箇所】
- Group G(維持): 仕訳完了モーダルの🎉、プラン名、お支払いありがとうございますバナー
- 代理店制度関連の Bronze/Silver/Gold 語彙
- バックエンドDB(users.cumulative_shiwake_count, graduated_rookie_at)
- /api/user/graduation-status エンドポイント
- 信頼度ダッシュボード(Task 4.3 で実装)

【動作確認の合格条件】
設計書の §10.3 動作確認チェックリスト全項目をパス。

【完了報告】
各 Group ごとに変更内容と diff を示してください。
```

### 6.11 共通: 完了報告フォーマット

```
## 完了報告

### 変更ファイル
- ファイル名1
- ファイル名2

### 変更内容(各ファイル diff)
[diff]

### 動作確認結果
- 合格条件1: ✅ OK
- 合格条件2: ✅ OK / ⚠️ 部分的に動作

### 影響範囲の確認
- 他のファイル/機能への波及: なし / あり(詳細)

### 注意事項
- 残課題があれば記載
```

---

## 7. 兄お披露目シナリオ

v3.0 §7 から変更なし。45分のデモシナリオ。

---

## 8. 進捗管理シート(運用例)

### 8.1 フェーズ進捗

| フェーズ | バージョン | 状態 | 開始日 | 完了日 | 備考 |
|---|---|---|---|---|---|
| Phase 1 | v2.3.0 | ✅ 完了 | - | 2026-05-XX | 実機テスト残 |
| **準備** | - | ✅ 完了 | 2026-05-10 | 2026-05-10 | pr-agent整理、CLAUDE.md |
| **Phase A1** | v2.3.1 | ⏳ 着手中 | - | - | **仕訳記録永続化+UI改訂+信頼度** |
| Phase A2 | v2.3.2 | ⏳ 未着手 | - | - | ワークスペース |
| Phase A3 | v2.3.3 | ⏳ 未着手 | - | - | 料金プラン |
| Phase 2 | v2.4.0 | ⏳ 未着手 | - | - | 自動エクスポート |
| Phase 3 | v2.5.0 | ⏳ 未着手 | - | - | 自動ルール学習 |
| Phase 4 | v2.6.0 | ⏳ 未着手 | - | - | 自動承認、兄お披露目 |

### 8.2 v2.3.1 のタスク進捗

| Group | Task | 内容 | 状態 |
|---|---|---|---|
| 1 | 1.1 | shiwake_records 作成 | ⏳ |
| 1 | 1.2 | workspace_trust_metrics 作成 | ⏳ |
| 1 | 1.3 | workspaces 仮設 | ⏳ |
| 1 | 1.4 | RPC関数作成 | ⏳ |
| 2 | 2.1 | master.js 改修 | ⏳ |
| 3 | 3.1 | default WS自動作成(新規ユーザー) | ⏳ |
| 3 | 3.2 | default WS自動作成(既存ユーザー) | ⏳ |
| 3 | 3.3 | /api/shiwake/approve | ⏳ |
| 3 | 3.4 | recalculateTrustMetrics | ⏳ |
| 3 | 3.5 | /api/trust-metrics | ⏳ |
| 4 | 4.1 | _aiProposed 保持 | ⏳ |
| 4 | 4.2 | approve() 改修 | ⏳ |
| 4 | 4.3 | 信頼度ダッシュボード | ⏳ |
| 4 | 4.4 | 承認後編集禁止 | ⏳ |
| 5 | 5.1 | UI言語置換 | ⏳ |
| 5 | 5.2 | バージョン表記 | ⏳ |

---

## 9. 関連ドキュメント(v3.1 で更新)

| ドキュメント | 役割 |
|---|---|
| `shiwake-ai_設計思想_v3_0.md` | 北極星 |
| `shiwake-ai_UI言語置換マップ_v3_0.md` | v2.3.1 入力 |
| `shiwake-ai_ワークスペース機能設計_v3_0_A3a.md` | v2.3.2 入力 |
| ~~`shiwake-ai_信頼度メトリクス設計_v3_0_A3b.md`~~ | 初版、**破棄** |
| `shiwake-ai_信頼度メトリクス設計_v3_0_A3b_v2.md` | **v2.3.1 入力(改訂版)** |
| `shiwake-ai_料金プラン拡張設計_v3_0_A3c.md` | v2.3.3 入力 |
| `shiwake-ai_戦略引き継ぎメモ_2026-05-10.md` | 戦略文脈 |
| **本書(統合実装ロードマップ v3.1)** | **実装の指針(改訂版)** |
| `~/APP/shiwake-ai/CLAUDE.md` | Claude Code 作業指示書(2026-05-10 配置済み) |
| `Step1_混入テーブル削除手順.md` | 完了済み(2026-05-10) |

---

## 10. 重要な「やらないこと」リスト

v3.0 §10 から変更なし。v2.6.0 までやらない機能を明示。

---

## 11. 最終チェックリスト(着手前)

- [x] 全7文書の整合性確認済み
- [x] pr-agent 混入テーブル整理済み(2026-05-10)
- [x] CLAUDE.md 配置済み(2026-05-10)
- [ ] Stripe テストモードの動作確認環境ある
- [ ] git リポジトリのバックアップ確認
- [ ] Claude Code の依頼文テンプレートが手元にある
- [ ] フェーズごとの動作確認チェックリストが手元にある

---

## 12. 改訂履歴

| 日付 | バージョン | 変更内容 |
|---|---|---|
| 2026-05-10 | v3.0 | 初版作成 |
| 2026-05-10 | v3.1(本書) | A-3b 初版破棄・v2 採用に伴う全面改訂、pr-agent整理・CLAUDE.md整備の完了反映、Phase v2.3.1 の範囲拡大(仕訳記録永続化追加) |

---

**作成日**: 2026年5月10日
**位置づけ**: 全7設計書を統合した実装の指針(改訂版)
**ゴール**: v2.6.0 で兄お披露目
**次のアクション**: v2.3.1 Phase A1 の Task 1.1(shiwake_records テーブル作成)から実行開始
