# CLAUDE.md - shiwake-ai プロジェクト

> このファイルは Claude Code / Claude(Web/Mobile版)に対する**作業指示書**です。
> プロジェクトのルートに配置し、Claude Code がセッション開始時に自動的に参照します。
>
> 最終更新: 2026年5月10日

---

## 🚨 最重要: プロジェクト識別

このプロジェクトは **shiwake-ai 本体** です。pr-agent とは別物です。

### Supabase プロジェクト情報

- **Project Name**: `shiwake-ai`
- **Project ID**: `tmddairlgpyinqfekkfg`
- **URL**: `https://tmddairlgpyinqfekkfg.supabase.co`
- **Organization**: `nice-gecko`

### ⚠️ pr-agent との取り違え禁止

別プロジェクト `shiwake-ai-pr-agent`(Project ID: `agpwkjybjcxquubkglel`)が存在します。**絶対に取り違えないこと**。

過去事例: 2026年5月以前に、pr-agent 用の9テーブル(leads, engagements, outreach_history, posts, trends, memory_bank, success_patterns, visual_assets, git_commits)が誤ってこのプロジェクトに作られた事故あり。**再発させないこと**。

### DB操作時の必須プロセス

DB に変更を加える前に、必ず以下を確認:
1. `SELECT current_database();` で接続先確認
2. server.js の `SUPABASE_URL` が `tmddairlgpyinqfekkfg.supabase.co` であることを再確認
3. テーブル作成前に「これは shiwake-ai 本体用か?」と自問
4. 不明な場合は**作業を止めてユーザーに確認**

---

## 📋 プロジェクト概要

shiwake-ai は、領収書・請求書をAIで仕訳CSV化するクラウドサービス。

### 主要機能(2026年5月時点)

- AI仕訳(Claude Sonnet による高精度判定)
- 取引先マスタ学習
- 主要会計ソフトCSV出力(freee/MF/弥生/勘定奉行/汎用)
- 自動取り込み(メール/Dropbox/GDrive)
- スタッフ管理・インセンティブ
- 代理店制度(Bronze/Silver/Gold 階段制)

### 戦略方針(2026年5月戦略転換)

- **ターゲット**: 税理士B2B(代理店モデル)
- **設計思想**: 「ユーザーがAIを評価する」体験(信頼度ベース)
- **キャリアパス物語は廃止**: ルーキー/ジュニア/シニア等の語彙は使わない
- **ワークスペース機能**: 複数顧問先を1アカウントで分離管理

詳細は `shiwake-ai_設計思想_v3_0.md` を参照。

---

## 🏗️ 技術スタック

| 領域 | 技術 |
|---|---|
| バックエンド | Node.js(server.js、純Node、フレームワークなし) |
| フロント | 純HTML/JS(index.html 単一ファイル、SPAではない) |
| DB | Supabase(PostgreSQL) |
| 認証 | Firebase Auth |
| 決済 | Stripe |
| AI | Claude API(Sonnet 4.6 / Haiku 4.5) |
| ホスティング | Render(バックエンド)、Cloudflare(フロント) |

### 重要なファイル構造

```
~/APP/shiwake-ai/
├── server.js          # メインサーバ(2344行)
├── index.html         # フロント全体(4957行)
├── master.js          # 取引先マスタ管理
├── hashes.js          # ハッシュキャッシュ
├── session.js         # 仕訳セッション管理
├── package.json
├── masters/           # マスタJSONファイル(uid別)
├── hashes/            # ハッシュキャッシュJSONファイル(uid別)
└── legal/             # 規約類
```

---

## 👤 ユーザー(和泉大介)対話ルール

### 必須ルール

1. **トークン節約は重要**: コードを書く・大量出力する作業は、必ず**事前に承認を得る**
2. **セルフチェック5回**: 作業に間違いや漏れがないか、自分で5回確認すること
3. **回答は簡潔に**: 長すぎる回答は読むのが追いつかない。必要なことを簡潔に
4. **早とちり禁止**: 似たような確認の往復は混乱の元。しっかり考えてから動く
5. **DLからの移動コマンド不要**: ファイル移動の指示は不要
6. **「いちいち休むとか聞いてこないで」「淡々と進める」**

### 役割分担

- **Claude(Web版)**: 指示出し役、設計担当、レビュー担当
- **Claude Code**: 実装担当(コードを書く)
- ただし Claude もたまにコードを書く場合あり

### 出力フォーマットの色分けルール

ユーザーが複数の実行環境(Claude Code、Supabase SQL Editor、ブラウザコンソール、ターミナル)を使い分けるため、コードブロックの直前に必ず以下のマークを付ける:

| マーク | 意味 |
|---|---|
| 🟦 **【Claude Code へ】** | Claude Code に貼り付ける依頼文 |
| 🟧 **【Supabase SQL Editor へ】** | Supabase SQL Editor で実行するSQL |
| 🟩 **【ブラウザコンソールへ】** | F12のコンソールで実行するJS |
| 🟪 **【ターミナルへ】** | bashコマンド |

複数ブロックを混在させる場合、特に重要。1つのメッセージに複数の実行先がある場合は、それぞれにマークを付けて取り違えを防ぐ。

### デプロイコマンドのルール

ユーザーは `~/APP/shiwake-ai` にいる前提。ディレクトリ移動の指示は不要。
デプロイは以下の3コマンドを1ブロックで提示:

```bash
git add [変更ファイル]
git commit -m "vX.Y.Z: 変更内容"
git push origin main
```

### 進捗可視化のルール

「今どこ?」「全体の流れ確認」と聞かれた場合、2段アコーディオン形式で答える:
1. 上段: 現在位置のサマリー(ピル/バッジ)
2. 下段: 詳細(クリックで展開、再度クリックで畳む)

実装の場として「ビジュアライザー」(Claude Web版の機能)を優先。

---

## 🎨 設計思想(v3.0、2026年5月確立)

### 顧客向け UI 原則

- **数字で語る**: 「育成中⭐⭐⭐⭐⭐」のような曖昧表現は禁止、すべて数字(承認率97%等)
- **ユーザーが自分で開放する**: AIが判定するアンロックではなく、ユーザー判断による任意の機能有効化
- **透明性**: AIが何を見て判断したか、何を学習したかを全て見せる
- **税理士限定に見せない**: 「税理士」「事務所」等の語彙は中立的なものに置換(「ワークスペース」等)

### 廃止する語彙(顧客向け、index.html対象)

- ルーキー / ジュニア / シニア / エージェント / エリート(プラン名以外)
- 卒業 / 昇格 / 育成度
- 「あなたは成長しました」「卒業おめでとう」
- 🎉(キャリアパス系の祝意のみ削除、業務完了の🎉は維持)

### 維持する語彙

- プラン名としての「Agent ライト/プレミアム/エリート」(機能差別化の名前)
- 代理店制度の Bronze/Silver/Gold(代理店向けは育成物語維持)
- 「Phase 1〜4」(開発フェーズ呼称)

---

## 🔧 DB スキーマ(2026年5月時点)

### shiwake-ai 本体用テーブル(7個)

| テーブル名 | 主要列 |
|---|---|
| `users` | id, plan_key, edition, is_paid, cumulative_shiwake_count, graduated_rookie_at, is_reseller, current_tier, billing_period_end, monthly_count |
| `inbox_files` | id, uid, source, source_id, file_path, processed_at |
| `inbox_addresses` | id, uid, local_part, is_active, created_at, revoked_at |
| `cloud_connections` | id, uid, provider, access_token, folder_id |
| `incentive_events` | id, uid, staff_email, event_type, amount |
| `invites` | id, owner_id, email, status, accepted_at |
| `automation_settings` | uid, auto_intake_enabled, auto_shiwake_enabled |

### ファイルベース管理

- `masters/master_<uid>.json`: 取引先マスタ
- `hashes/hashes_<uid>.json`: ハッシュキャッシュ

### 仕訳記録の保存先

**重要**: 仕訳記録は DB の `shiwake_records` テーブルには**保存されていない**。
session.js 経由で**セッションファイル**として一時保存される。
2026年5月時点で、累積仕訳記録の永続化機構は未実装。

---

## 🚧 進行中の作業(2026年5月10日時点)

### 戦略方針

v2.6.0(Phase 4 自動承認)まで実装し、兄(税理士)に完成品をお披露目。
ロードマップ詳細は `shiwake-ai_統合実装ロードマップ_v3_0.md`。

### 設計ドキュメント(参照必須)

| ドキュメント | 役割 |
|---|---|
| `shiwake-ai_設計思想_v3_0.md` | **北極星** |
| `shiwake-ai_UI言語置換マップ_v3_0.md` | UI改訂指示 |
| `shiwake-ai_ワークスペース機能設計_v3_0_A3a.md` | ワークスペース機能 |
| `shiwake-ai_信頼度メトリクス設計_v3_0_A3b.md` | 信頼度(※書き直し中) |
| `shiwake-ai_料金プラン拡張設計_v3_0_A3c.md` | 料金プラン |
| `shiwake-ai_統合実装ロードマップ_v3_0.md` | 工程表 |

### 既知の課題

- A-3b は仕訳記録テーブルの存在を前提として書かれているが、実際は存在しない → 書き直し中
- 仕訳記録の DB 保存機構を新規実装する必要あり(A-3d として別途設計予定)

---

## ⚠️ 作業時の必須確認事項

### コードを変更する前に

1. 設計書(該当のもの)を参照する
2. 設計書のセクション番号で引用する
3. 「変更してはいけない箇所」を明確にする
4. 動作確認の合格条件を事前に定義する

### コードを変更した後に

1. 変更前/変更後の diff を提示する
2. 動作確認結果を報告する
3. 他のファイル/機能への波及がないか確認する
4. 注意事項・残課題があれば明示する

### Claude のよくあるミス(自己防衛)

1. **指示の一部だけ実行** → タスクをチェックリスト化して全項目実行
2. **影響範囲の見落とし** → 関連する全ファイルを grep してから変更
3. **既存コードへの過剰変更** → 必要最小限の変更に留める
4. **動作確認の省略** → 必ず合格条件をクリアしてから完了報告

---

## 📝 メモ(過去のミス記録)

### 2026年5月以前: pr-agent テーブル混入事故

shiwake-ai プロジェクト(`tmddairlgpyinqfekkfg`)に、pr-agent 用テーブル9個が誤って作成された事故あり。pr-agent 用テーブル(leads 等)はこのプロジェクトには絶対に作らないこと。

**再発防止**:
- DB操作前に必ず Project ID を確認
- pr-agent 関連のテーブル名(leads, engagements, outreach_history, posts, trends, memory_bank, success_patterns, visual_assets, git_commits)をこのプロジェクトに作成しようとした場合は、**即座に作業を止めてユーザーに確認**

---

**END OF CLAUDE.md**
