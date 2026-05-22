# shiwake-ai 証憑回収機能 設計議論メモ 2026-05-22（夜）

> 作成日: 2026-05-22
> ステータス: 設計議論完了、正式設計書化前
> 出典: `shiwake-ai_証憑回収機能_設計メモ_v1.md` + 本セッション議論（DSK + Claude Opus 4.7）
> 位置づけ: 正式設計書 `shiwake-ai_証憑回収機能設計_v3_0_0.md`（仮）に昇格させるための入力資料

---

## 1. 用語マッピング（設計メモv1から変更）

| 旧（設計メモv1） | 新（本メモで確定） |
|---|---|
| 催促（手動アクション） | お知らせを送る |
| 自動催促（段階2） | 自動お知らせ |
| 催促文面のテンプレ | お知らせ文面のテンプレ |
| 催促済（ステータス） | 廃止（履歴情報として送信回数のみ保持） |
| 機能名（ユーザー向け表示） | 証憑回収（内部呼称・サイドバー） |
| あるべき姿（設計概念） | UIラベル上は「集めるべき証憑」 |

> 実際に顧問先に届くメール文面は丁寧表現を別途設計（テンプレ参照）。

---

## 2. v1 スコープ（確定）

### 2.1 含めるもの

- WS（顧問先）単位の「集めるべき証憑」登録
- 欠け検知（可視化のみ）
- お知らせ送信（手動ワンクリック、mailto: 誘導）
- 追跡（ステータス + お知らせ送信回数）

### 2.2 含めない（v2 以降）

- 自動お知らせ（スケジュール起動、自動送信）
- LINE / Slack 連携（まずメールから）
- 個人単位（同一 WS 内の複数担当者管理）
- 単発証憑（年1回の保険料控除等）

### 2.3 段階設計

- 段階1（v1）: 可視化のみ + 手動お知らせ
- 段階2（v2 以降）: 自動お知らせのアンロック（発火条件は v2 設計時に決める）

---

## 3. Q1〜Q5 確定事項

### Q1 「月」の境界

**暦月固定 + WS別締切日**
- 月の単位は全WS共通で 1日〜末日
- WSごとに「翌月◯日まで」の締切日を設定可能
- 締切日を過ぎても提出されなければ「締切超過」表示

### Q2 お知らせ文面のテンプレ管理

**グローバル既定 + WS別上書き可**
- アプリ側で 1 つのデフォルトテンプレを持つ
- WS設定でこのWS専用に上書きしたい場合は上書き可能
- 上書きしない WS はグローバル既定をそのまま使う

### Q3 既存メール送信機構の活用度

**mailto: 誘導**
- 「お知らせを送る」ボタンクリックで税理士本人のメーラーが開く
- 文面はテンプレを mailto: の body にプリセット
- 送信主体は税理士本人（顧問先には「いつものメールから来た」と見える）
- 制約: 本文の文字数制限あり、添付不可、改行はエンコード必要 → テンプレは短めに設計
- v2 の自動お知らせは SendGrid 送信API への移行で対応

### Q4 「来た」の判定方法

**半自動（月内アップロード件数表示 + 人間確定）**
- WS の月内アップロード件数をヘッダーに表示（自動）
- 各証憑行のステータスは人間が「✓ 届いたと記録」ボタンで確定
- AI 種別判定の自動連動は v2 で（突合機能 v2.7 の Haiku 書類種別判定の技術を流用予定）

### Q5 ステータスのライフサイクル

**2状態 + お知らせ送信回数（履歴）**
- ステータス: `pending`（未提出）/ `submitted`（提出済）の二値
- お知らせ送信回数は別カウンタ `notified_count` で管理（何回でも送れる）
- UIでは状態バッジは2種（未提出 / 提出済）のみ、送信回数は履歴情報として `✉ N回` で控えめに表示

---

## 4. UI 設計

### 4.1 メイン画面（証憑回収ダッシュボード）

#### ヘッダー
- タイトル: 「証憑回収」
- キャッチコピー: 「毎月集めるべき証憑が揃っているかを管理」
- サブ: 「2026年5月分の不足状況」
- 月ナビ: 前月 / 当月 / 翌月

#### 上部トグル
- `□ 不足だけ表示`（チェックで提出済を hide、揃ったWSも hide）

#### メトリック（4枚）
| メトリック | 表示 | 色 |
|---|---|---|
| 不足 | N 件 | warning（強調） |
| 締切超過 | N 件 | danger（強調） |
| 揃ったWS | N / 全N | 中立 |
| 月内アップ | N 件 | 中立 |

#### WSカード（WSごとに1枚）
- ヘッダー左: WS名 + 不足N件バッジ（揃ったときは「揃った」バッジ）+ 締切超過バッジ（該当時）+ 締切日
- ヘッダー右: `↑ 月内 N件 アップ` pill
- ボディ: 証憑行のリスト

#### 各証憑行
- 左: 種別アイコン + 証憑名
- 右: 状態バッジ + 履歴 + アクション
  - 状態バッジ: `未提出`（中立色）/ `提出済`（success色）
  - 履歴: `✉ N回`（送信履歴がある時のみ、小さく）
  - アクション（未提出のみ表示）:
    - `✉ お知らせを送る` ボタン → mailto: 起動
    - `✓ 届いたと記録` ボタン → ステータス更新
  - 提出済の行: 半透明 + アクション非表示

### 4.2 「集めるべき証憑」登録UI（WS設定モーダル内の新タブ）

#### タブ構成
- 基本情報
- メール振り分け
- **集めるべき証憑** ← 新規追加

#### フォーム

| ブロック | 内容 |
|---|---|
| 締切日 | 「翌月 [N] 日まで」のスピナー入力 |
| 毎月集めるべき証憑 | 自由テキスト入力のリスト + ドラッグ並び替え + `+ 証憑を追加` ボタン |
| お知らせ文面 | グローバル既定の表示 + `□ このWS用に上書きする` チェック + textarea（チェックON時に有効化） |

#### テンプレ変数
- `{{月}}` - 対象月
- `{{締切日}}` - WS別締切日
- `{{顧問先名}}` - WS名
- `{{不足証憑}}` - 不足している証憑名のリスト（カンマ区切り）

#### グローバル既定テンプレ（暫定）

```
{{月}}月分の証憑のご提出をお願いいたします。
お忙しいところ恐れ入りますが、{{締切日}}までにお送りいただけますでしょうか。
```

### 4.3 UI の追加デフォルト確定事項

| # | 論点 | 確定 |
|---|---|---|
| ① | 証憑名は自由テキストか選択肢か | 自由テキスト（v1）。種別タグ自動判定は v2 |
| ② | ドラッグ並び替え | v1 で見送り可（あれば良い） |
| ③ | テンプレ変数 | 上記 4 種 |
| ④ | 「集めるべき証憑」が 0 件の WS | 証憑回収機能のメイン画面に表示しない |
| ⑤ | 証憑削除時の確認 | 確認ダイアログ（誤操作防止） |

---

## 5. DB スキーマ案

### 5.1 新規テーブル 2 個

```sql
-- 集めるべき証憑（WS別の登録）
CREATE TABLE required_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                  -- 証憑名（クレカ明細 等）
  sort_order INT DEFAULT 0,            -- 並び順
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_required_documents_workspace ON required_documents(workspace_id);
```

```sql
-- 月別ステータス
CREATE TABLE document_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  required_document_id UUID NOT NULL REFERENCES required_documents(id) ON DELETE CASCADE,
  year_month CHAR(7) NOT NULL,          -- '2026-05'
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'submitted'
  notified_count INT DEFAULT 0,
  last_notified_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(required_document_id, year_month)
);

CREATE INDEX idx_document_status_year_month ON document_status(year_month);
CREATE INDEX idx_document_status_status ON document_status(status);
```

### 5.2 既存テーブル変更

```sql
-- workspaces に締切日と上書きテンプレを追加
ALTER TABLE workspaces ADD COLUMN deadline_day_of_next_month INT DEFAULT 5;
ALTER TABLE workspaces ADD COLUMN custom_notification_template TEXT;
```

### 5.3 グローバル既定テンプレの保存先

- `users.global_notification_template`（カラム追加）または、固定値としてアプリ側に直書き
- 推奨: `users` テーブルに追加（ユーザー単位でカスタマイズ可能にする）

---

## 6. 主要 API（暫定）

### 6.1 「集めるべき証憑」管理

| メソッド | パス | 用途 |
|---|---|---|
| GET | `/api/workspaces/:id/required_documents` | 一覧取得 |
| POST | `/api/workspaces/:id/required_documents` | 新規追加 |
| PATCH | `/api/required_documents/:id` | 名前・順序更新 |
| DELETE | `/api/required_documents/:id` | 削除 |

### 6.2 月別ステータス

| メソッド | パス | 用途 |
|---|---|---|
| GET | `/api/workspaces/:id/document_status?year_month=2026-05` | WS の月別状況取得 |
| POST | `/api/document_status/:id/mark_submitted` | 「届いたと記録」 |
| POST | `/api/document_status/:id/log_notification` | お知らせ送信ログ（mailto: 起動時に発火） |
| GET | `/api/document_status/summary?year_month=2026-05` | 全WSの集計（メトリック用） |

### 6.3 テンプレ管理

| メソッド | パス | 用途 |
|---|---|---|
| GET | `/api/me/notification_template` | グローバル既定テンプレ取得 |
| PATCH | `/api/me/notification_template` | 既定更新 |
| GET | `/api/workspaces/:id/notification_template` | WS別上書き取得 |
| PATCH | `/api/workspaces/:id/notification_template` | WS別上書き設定 |

---

## 7. 既存機能との関係

### 7.1 突合機能（v2.7）との関係

- 独立した機能。同じコンプリートパックに同居するが、ユーザーが片方だけ使うのも自由
- データソースの共有: 仕訳記録（`shiwake_records`）の連動は v1 では避ける（独立性優先）
- v2 で AI 種別判定を入れる際、突合の Haiku 書類種別判定（領収書/通帳/カード明細/請求書）の技術を流用

### 7.2 サイドバー配置

```
1. 取り込む
2. 仕訳する
3. 出力する
4. 突合する
5. 証憑回収する  ← 新規追加（突合の隣）
設定
```

### 7.3 プラン制限

- コンプリートパック以上で利用可能
- ベーシック / オートメーション: サイドバーに鍵アイコン + ロック画面（既存の plan_key 機能ゲーティング `canUsePlanFeature()` を流用）

---

## 8. 未解決事項（v1 着手時に詰める）

| # | 論点 | 備考 |
|---|---|---|
| 1 | 過去月閲覧の挙動 | 月ナビで遡れる、確定済みの月は read-only 表示 |
| 2 | 月内アップロード件数のクリック挙動 | クリックでその月内アップロード一覧をモーダル表示？ |
| 3 | 削除済の `required_document` の月別ステータス | 履歴として残すか CASCADE で消すか |
| 4 | 月跨ぎのステータス生成タイミング | 月初に自動生成？ 初回アクセス時？ |
| 5 | mailto: 文面の長さ制限テスト | ブラウザ別の制約確認が必要 |

---

## 9. 次のアクション

1. 本メモを `~/APP/shiwake-ai/docs/` に保存
2. プロジェクトナレッジに手動アップロード（GitHub と自動同期されないため）
3. 正式設計書 `shiwake-ai_証憑回収機能設計_v3_0_0.md` に昇格（CC 依頼）
4. 段階2（自動お知らせアンロック）の発火条件は v2 設計時に議論

### 9.1 正式設計書化のための CC 依頼イメージ（次セッション用）

正式設計書化は本メモを下敷きに、以下のセクション構成で CC に作成依頼:

1. 概要（目的、設計思想との接続、サイドバー配置）
2. 用語定義
3. データソース・スキーマ（DB / API）
4. UI 設計（メイン画面 / 登録UI / 各画面のワイヤー）
5. 動線・状態遷移図
6. 既存機能との関係
7. 段階1 / 段階2 の境界
8. 実装スコープと工程分解
9. 動作確認チェックリスト
10. リスクと対策

### 9.2 実績見積もり（参考）

- 設計書作成: CC 依頼 30〜45 分
- 実装: 3〜5h（夜セッション引き継ぎの見積もり通り）

---

## 10. 体制・進め方の前提（継承）

- Claude（指示出し）+ Claude Code（実装）の分担
- 動作確認は本番で行う（課金ユーザー 0 人、ローカルはログイン不可）
- 実装 → push → 本番確認 の順
- 色分けマーク（🟦🟧🟩🟪）、実績ベース見積もり、2 段アコーディオン
- セッション開始時は ROADMAP.md を真っ先に読む
- セッション終了時は ROADMAP.md を更新

---

**本メモは、2026-05-22 夜セッション後半（DSK + Claude Opus 4.7）にて、設計メモv1（`shiwake-ai_証憑回収機能_設計メモ_v1.md`）の論点 Q1〜Q5、UI モック 2 画面（メイン + 登録）、用語マッピング、DB スキーマ、API 設計までを詰めた成果物。次セッションでこのメモを下敷きに正式設計書化に進む。**
