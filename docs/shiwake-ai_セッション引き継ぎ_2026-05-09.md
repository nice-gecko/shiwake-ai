# shiwake-ai セッション引き継ぎ文書

> **このドキュメントの位置づけ**
> 2026年5月8〜9日にかけての超長時間セッションを、別の Claude チャットに引き継ぐための文書。
> 新しいチャットの最初にこれを貼れば、Claude が即座に状況を把握して作業を続行できる。
>
> **作成日**: 2026年5月9日(土)
> **次のセッションで継続する作業**: PR Agent Phase 1 残タスク(T1-6 Writer ノード以降)+α

---

## 🎯 新しいチャットへの最初の指示(コピペ用)

新しいチャットを開いたら、以下をコピペしてください:

```
shiwake-ai プロジェクトの続きをやります。
前回のセッションの引き継ぎ文書(本文書)を読み込んで、状況を把握してください。

主な引き継ぎポイント:
1. shiwake-ai 本体は v2.2.1 で稼働中、Render に独自ドメイン shiwake-ai.com で公開済み
2. 代理店規約 v1.4 ドラフト完成、3AI 4ラウンドレビュー後「弁護士監修移行可」獲得
3. PR Agent Phase 1 進行中(T1-1〜T1-5 完了、次は T1-6 Writer ノード)
4. PR Agent は v3 骨組み(Cowork組込版)に移行済み

ユーザー対話ルール(継承・厳守):
- コードを書く前に承認を得る(トークン節約)
- セルフチェック5回(Claude内部確認)
- DLからの移動コマンド不要、cd後すぐ git add/commit/push の一括コマンド提示
- 実装は Claude Code に分担、Web版Claude は指示出し・判断役
- push時は index.html のバージョン表記もバンプ
- 「いちいち休むとか聞いてこないで」(疲労判断は不要、淡々と進める)

詳細は以下を読んでください。
```

---

## 📋 セッションの全体像

### 期間
2026年5月8日(金) 〜 5月9日(土)の連続作業

### 達成した主要マイルストーン

第一に、**v2.2.0 実装完了**: STRIPE_PLANS 刷新、機能フラグ EDITION_FEATURES、canUse() 関数、/api/user/plan、webhook 拡張、月初リセット、代理店API群、scripts/update-reseller-tiers.js、index.html 改修

第二に、**Stripe 設定完了**: プラン24種(通常9 + 代理店12 + インセンティブ3)、Coupon 2種(silver_discount/gold_discount)、webhook 6イベント登録

第三に、**Supabase users テーブル拡張**: 9列追加(plan_key, edition, billing_period_start/end, is_reseller, reseller_uid, current_tier, referral_code, affiliate_application)、3インデックス

第四に、**v2.2.1 バグ修正**: クエリパラメータ付きURL(/?ref=TEST123)が404になっていたバグ修正、index.html バージョン表記更新

第五に、**代理店規約 v1.0 → v1.4 完成**: 3AI(ChatGPT/Gemini/Grok)による4ラウンドレビュー、最終評価8.87/10、3AI全員「弁護士監修可」と判定

第六に、**引き継ぎ文書 v2.2.1 作成**: 766行、60TODO、Stripe price_ID 24件全記載

第七に、**PR Agent v3 骨組み作成**(Cowork組込版): v2 → v3 で約1〜1.5週間の工数削減、DSKさん日次作業 30〜45分→10〜15分

第八に、**PR Agent T1-1〜T1-5 実装完了**: 環境構築、schema.sql 適用、config YAML 5本、12枚画像 Supabase アップロード、ui_annotator.py 実装

第九に、**ファイル整理完了**: shiwake-ai/ 直下を整理、docs/ 新設、legal/ 整理、.gitignore 整理(.DS_Store全階層除外)

---

## 🏗️ プロジェクト基本情報

### リポジトリ・URL

| 項目 | 値 |
|---|---|
| GitHub | https://github.com/nice-gecko/shiwake-ai |
| 本番URL(独自ドメイン) | https://shiwake-ai.com |
| 旧URL(Render直) | https://shiwake-ai.onrender.com |
| ローカル | ~/APP/shiwake-ai (DSK-MacBook-Pro) |
| 利用規約 | https://shiwake-ai.com/terms |
| プライバシーポリシー | https://shiwake-ai.com/privacy |
| 特商法表記 | https://shiwake-ai.com/tokushoho |

### 運営者情報

| 項目 | 値 |
|---|---|
| 運営者 | 合同会社和泉グミ (izumi-gummy LLC) |
| 代表者 | 和泉大介 |
| 所在地 | 〒152-0031 東京都目黒区中根1-7-16-701 |
| 連絡先 | support@shiwake-ai.com |
| メイン管理者 | easy.you.me@gmail.com (Claude Pro/Maxプラン) |

### 技術スタック

| レイヤー | 技術 |
|---|---|
| フロントエンド | HTML/CSS/JavaScript (vanilla) |
| バックエンド | Node.js (server.js) |
| 認証 | Firebase Auth |
| データベース | Supabase (project_id: tmddairlgpyinqfekkfg, region: ap-northeast-1) |
| 決済 | Stripe (現在テストモード) |
| ホスティング | Render |
| メール | SendGrid (Cloudflare Email Routing 経由) |
| AI | Anthropic API (Claude Sonnet 4.6 / Haiku 4.5) |

### 重要キー(参考用、実体は環境変数)

```
Supabase URL: https://tmddairlgpyinqfekkfg.supabase.co
Supabase Secret Key: shiwake_ai (sb_secret_Xhbqc... 形式の新方式)
Stripe Webhook ID: empowering-finesse
```

---

## 📁 ディレクトリ構造(整理後・最終形)

```
~/APP/shiwake-ai/
├── 【本体コード】(直下、Render が読む)
│   ├── server.js
│   ├── index.html
│   ├── privacy.html
│   ├── terms.html
│   ├── tokushoho.html
│   ├── session.js
│   ├── master.js
│   ├── master.json
│   ├── hashes.js
│   ├── package.json
│   ├── package-lock.json
│   └── README.md
│
├── 【設定ファイル】
│   ├── .env (環境変数、git に上げない)
│   ├── .gitignore (.DS_Store全階層除外、Python/IDE関連)
│   └── .git/
│
├── 【サブディレクトリ】
│   ├── hashes/ (ハッシュキャッシュ)
│   ├── masters/ (マスタディレクトリ)
│   ├── node_modules/
│   └── scripts/ (update-reseller-tiers.js など)
│
├── 【ドキュメント】(本日整理)
│   └── docs/
│       ├── shiwake-ai_v2_2_0_仕様書.md
│       ├── shiwake-ai_引き継ぎ_v1_3_1.md
│       ├── shiwake-ai_引き継ぎ_v2_1_0.md
│       └── shiwake-ai_引き継ぎ_v2_2_1.md (本日追加)
│
├── 【法的書類】(本日整理)
│   └── legal/
│       ├── shiwake-ai_代理店規約_v1_0_draft.md (履歴用)
│       └── shiwake-ai_代理店規約_v1_4_draft.md (最終版・現役)
│
└── 【PR Agent サブプロジェクト】
    └── pr-agent/
        ├── brain/
        ├── config/ (YAML 5本)
        ├── connectors/
        ├── cowork_handoff/ (v3新設、Cowork指示書集約)
        │   └── README.md
        ├── dashboard/
        ├── memory/ (schema.sql)
        ├── notify/
        ├── visuals/
        │   ├── ui_annotator.py (T1-5実装済み)
        │   ├── upload_assets.py (T1-4実装済み)
        │   └── raw/manual/ (12枚画像、Image 2/4/9 マスク済み)
        ├── shiwake-ai-PR-Agent_実装指示書_v3_骨組み.md (現役主参照)
        ├── shiwake-ai-PR-Agent_実装指示書_v2.md (アーカイブ)
        ├── PartA/B/C_*.md (v2 元ソース、アーカイブ)
        ├── patch_001_x_manual.md (X手動投稿パッチ)
        └── demo_account_setup_guide.md
```

---

## 🎯 現在進行中の作業: PR Agent Phase 1

### 現在の進行状況

```
Phase 1 (Week 1-2):
  Week 1:
    ✅ T1-1: Cloud Run + Supabase 環境構築
    ✅ T1-2: schema.sql 適用 (10テーブル)
    ✅ T1-3: config YAML 5本作成 (personas/characters/weapons/triggers/time_table)
    ✅ T1-4: 12枚画像 Supabase Storage 登録 + visual_assets テーブル
    ✅ T1-5: ui_annotator.py で12枚一括検証
    ⏳ T1-6: Writer ノード実装 ← 次にやる

  Week 2:
    ⏸ T2-1: Threads APIコネクタ
    ⏸ T2-2: Publisher 実装 + 承認連動(X分岐含む)
    ⏸ T2-3: 承認ダッシュボード(FastAPI + Tailwind 簡易版、X用コピーUI追加)
    ⏸ T2-4: LINE/Discord 通知
    ⏸ T2-5: Planner(Gitログ素材化 + 時間帯テーブル参照)
    ⏸ T2-6: Cowork指示書作成(morning_review.md, x_manual_post.md)← v3新設
```

### 次にやること(具体的)

**T1-6: Writer ノード実装**

仕様(v2/v3 とも変化なし):
- キャラ×構文×3軸トリガーの3軸プロンプト合成
- 5キャラ(shoyo_kun/shoyo_chan/zeirishi_sensei/keiri_san/shacho)
- 6構文ウェポン(W1〜W6)
- 3軸トリガー(Antagonism/Altruism/Storytelling)
- Plannerが「P4×zeirishi_sensei×W3×Altruism×8:00投稿」のように4軸で組み合わせを決定

実装場所: `~/APP/shiwake-ai/pr-agent/brain/writer.py`

参照ファイル: `pr-agent/shiwake-ai-PR-Agent_実装指示書_v3_骨組み.md`

### Claude Code での進め方

```
ターミナルで Claude Code を起動 → 「T1-6 Writer ノードを進めて、着手前に確認して」

Claude Code が
  「これから Writer ノードを実装します。
   キャラ×構文×トリガーの3軸プロンプト合成を含めます。
   よろしいですか?」
と聞いてくる

→ 「OK、進めて」と返答
→ Claude Code が実装開始
```

---

## 🔑 ユーザー対話ルール(継承・厳守)

### トークン節約
- **コードを書く前に承認を得る**
- 大規模な変更は事前に説明・効果見積もりを提示
- 実装は Claude Code に分担、Web版Claude は指示出し・判断役

### ミス防止
- セルフチェック5回(Claude内部での確認)

### コミュニケーション
- 文章は簡潔に(長文回避)
- DLからの移動コマンド不要、cd後すぐ git add/commit/push の一括コマンド
- **疲労判断・休憩提案は不要**(「いちいち休むとか聞いてこないで」)

### バージョンアップの判断
- 安全な変更は即実装、リスクある変更は別バージョン分割を提案
- push時は index.html のバージョン表記もバンプ
  - バグ修正: パッチ+1
  - 機能追加: マイナー+1
  - 破壊的変更: メジャー+1

### デプロイコマンド

```bash
cd ~/APP/shiwake-ai && \
node -c server.js && \
git add [変更ファイル] && \
git commit -m "vX.Y.Z: 変更内容" && \
git push origin main
```

GitHubへのpushでRenderが自動デプロイ。

---

## 🎬 ロードマップ全体像

```
v2.0.0 - 戦略・プロダクト方向性の確定 ✅完了
v2.1.0 - Agent Elite 新設・5階層キャリアパス ✅完了
v2.2.0 - プラン分離(機能フラグ実装) ✅完了
v2.2.1 - クエリ404バグ修正 ✅完了 ← 今ここ

【Phase 1: ルーキー対応】
v2.3.0 - 自動取り込み実装(メール/フォルダ監視)

【Phase 2: ジュニア対応】
v2.4.0 - 自動エクスポート実装(会計ソフト別CSV+フォルダ)

【Phase 3: シニア対応】
v2.5.0 - 自動ルール学習実装(Agentがパターン検出)

【Phase 4: エージェント対応】
v2.6.0 - 自動承認実装(信頼度95%超の自動確定)

【共通機能】
v2.7.0〜v2.10.0 - 異常検知・テンプレ・ダッシュボード

v3.0.0 - 真のAgent化(会計ソフトAPI連携、能動的質問など)

【Phase 5: エリート対応 = ダブルO / Project Double-O】
v3.1.0〜v3.5.0 - 対話モード・文脈横断・締め自走・決算事前準備

v4.0.0 - Elite最終形(全能力統合・運用最適化) ← 完成 🏁
```

完成までの想定: **8ヶ月〜1年半**(全部一人の場合)

### ポジショニング(継承)

| 項目 | v1.x | v2.x |
|---|---|---|
| ポジショニング | 「AI機能を持つSaaS」 | 「**AI記帳エージェント**」 |
| 売り方 | ツール比較 | **人件費比較** |
| 価格モデル | ID課金単独 | **月額固定 + 件数従量のハイブリッド** |

### 5階層キャリアパス

| レベル | 階層名 | 対応プラン | アンロック機能 |
|---|---|---|---|
| Lv1 | ルーキー | Agent ライト〜 | 自動取り込み(Phase 1) |
| Lv2 | ジュニア | Agent ライト〜 | 自動エクスポート(Phase 2) |
| Lv3 | シニア | Agent ライト〜 | 自動ルール学習(Phase 3) |
| Lv4 | エージェント | Agent ライト〜 | 自動承認(Phase 4) |
| **Lv5** | **エリート** | **Agent エリート専用** | 対話・文脈横断・締め自走・決算事前準備(Phase 5) |

### キャッチコピー
**メイン**: ルーキーから、エージェントへ。そしてエリートへ。
**内向き呼称**: ダブルO / Project Double-O(Elite開発コードネーム)

---

## ⚖️ 代理店規約 v1.4 の概要

### 進化の軌跡

| バージョン | 評価 |
|---|---|
| v1.0 | 5〜6.5/10(初版) |
| v1.1 | 6.5〜8/10(3AI 1ラウンド目反映) |
| v1.2 | 8〜9/10(3AI 2ラウンド目反映) |
| v1.3 | 8.87/10(プロダクト実態反映) |
| **v1.4** | **9〜9.5/10見込み**(軽微修正で完成) |

### v1.4 の核心: 第14条第1項の業法ガード5重構造

```
1. CSV出力する計算補助ツール(プロダクト性質の定義)
2. 確定行為を一切行わない(行為レベルの否認)
3. UI上で確定操作機能を提供しない(実装レベルの否認)
4. 会計帳簿の作成責任を負わない(責任範囲の限定)
5. 特定の税務申告の適法性を保証しない(結果保証の否定)
```

### 法務戦略

| フェーズ | 状況 | アクション |
|---|---|---|
| Phase A: 立ち上げ期 | **今ここ** | AI法務チェックで運用、走りながら改善 |
| Phase B: 拡大期(代理店5社超) | 将来 | 弁護士による正式監修(数万〜十数万円) |
| Phase C: 安定期(代理店10社超) | 将来 | 法務顧問契約検討 |

### 弁護士監修推奨論点(将来用)

第一に、第14条「CSV出力ツール」整理が税理士会の運用解釈と整合するか
第二に、第2条第4項の民法537条「第三者のためにする契約」概念の有効性
第三に、第17条第3項(4)販売奨励金の税務取扱い
第四に、第19条の損害賠償上限の有効性
第五に、第12条第3項オプトアウトの実装可能性
第六に、特商法上の代理店経由販売の表記要件

---

## 🤖 PR Agent v3 概要

### v2 → v3 の核心変更
- Anthropic Cowork(DSKさんの Claude Pro/Max 契約に既に含まれる)を運用補助として組み込み
- Phase 4(営業ツール)を Cowork で代替する形で実装工数削減
- 開発期間 5週間 → 3.5〜4週間
- DSKさん日次作業 30〜45分 → 10〜15分

### 凡例マーク

```
🤖 Cloud Run Agent  = LangGraph で動く 24時間自律本体
👨‍💻 Claude Code      = ローカルでコード実装(本実装指示書の対象)
🖥 Cowork           = DSKさんの Mac で動く AI 同僚(別指示書で運用)
👤 DSKさん本人       = 手動操作(Cowork で削減対象)
```

### Cowork 利用上のリスク管理(継承事項)

第一に、**Stripe 関連の操作は Cowork に渡さない**(プロンプトインジェクション攻撃リスク)
第二に、**顧客個人情報の処理は Cowork に渡さない**
第三に、**Anthropic 自身が「センシティブデータを扱うアプリと同時使用するな」と推奨**(2026年4月時点)
第四に、**API キーは Cowork に渡さない**(環境変数のまま、Cloud Run側で保持)

---

## 📊 直近 git コミット履歴

```
67301cb  chore: .gitignore整理 - .DS_Store全階層除外、Python/IDE関連追加
e1417b8  v2.2.1: ファイル整理 - docs/ 新設、legal/ 整理、引き継ぎ文書 v2.2.1 + 代理店規約 v1.4 追加
743d3c2  feat: T1-5 ui_annotator + v3 Cowork組込移行 (sales→cowork_handoff)
f845269  fix: upload_assets バグ修正 + バケット自動作成 (T1-4完了)
e7a41e4  feat: add visuals/upload_assets.py for T1-4
39e7fde feat: add config YAML 5本 + config_loader.py (T1-3)
73a198a feat: add Supabase schema (10 tables, patch_001 applied)
```

---

## 🚨 ここで停止していたらしくない場合の確認

新しいチャットで作業再開する前に、状況確認のため以下を実行してもらうと確実:

```bash
# 1. 現在の git の状態
cd ~/APP/shiwake-ai
git status
git log --oneline -5

# 2. PR Agent の進行状況
ls -la ~/APP/shiwake-ai/pr-agent/brain/
# writer.py があれば T1-6 着手済み、なければ未着手

# 3. ファイル構造確認
ls -la
ls -la docs/
ls -la legal/
ls -la pr-agent/cowork_handoff/
```

---

## ⏭️ TODO リスト(優先度別)

### 🔴 優先度・高(直近の作業)

第一に、**PR Agent T1-6 Writer ノード実装**(これが Phase 1 の核心、5キャラ×6構文×3トリガーの3軸プロンプト合成)

第二に、**PR Agent Phase 1 完走**(T2-1〜T2-6、Threads APIコネクタ、Publisher、承認ダッシュボード、LINE通知、Planner、Cowork指示書 2本作成)

第三に、**Phase 1 完了の定義チェック**:「DSKさんが朝LINE通知を受けて、3案からスマホで1案承認 → Threadsに投稿される」が動く状態

### 🟡 優先度・中(リリースと並行)

第一に、**Render Cron Job 設定**(scripts/update-reseller-tiers.js、月次ランク判定、$1認証必要)

第二に、**代理店募集の営業準備**(LP、1ページ説明資料、第1号代理店候補=身内の税理士)

第三に、**本番モード移行戦略の策定**(Stripe本番アカウント審査・法人銀行口座準備等)

第四に、**LP・営業資料作成**(エンドユーザー向けLP、スクショ、機能紹介動画)

第五に、**ファーストカスタマー戦略**(身内の税理士事務所での試験運用)

### 🟢 優先度・低(運用開始後)

第一に、**v2.2.x 件数従量課金**(Stripe Metered Billing)

第二に、**v2.3.0 以降 Phase 1 自動取り込み**(メール送信先アドレス、フォルダ監視)

第三に、**マーケティング**(note記事、X発信、コミュニティ参加)

第四に、**機能レベルの将来課題**(信頼度算出、ロールバック機能、業種テンプレート、Myテンプレート、異常検知)

詳細は `docs/shiwake-ai_引き継ぎ_v2_2_1.md` 参照(60項目あり)。

---

## 🎨 設計思想(継承事項)

第一に、**ユーザー体験の核**: 「何をどう判断させるかを明確に見せること」が継続利用につながる

第二に、**機能追加時の指針**: 「ユーザーが自分のツールとして育てている実感」を意識する

第三に、**AI仕訳精度ファースト**: コスト最適化より仕訳精度を優先

第四に、**セルフ差別化**(高価格モデル成立): 廉価版があるから、高価格版の特別感が伝わる

第五に、**メタファーは2つを併用**: コピー=人間メタファー(キャリアパス)、機能名=能力メタファー

第六に、**「アンロック」と「常時機能」を区別する**: アンロック=ユーザーが信頼を委ねる代わりに自動化、常時機能=安全装置

第七に、**プッシュ→プルの転換**: レポートは「届く」のではなく「ダッシュボードで見に行く」

第八に、**会計ソフトAPI連携の現実解**: API ではなく CSV+フォルダに着地

第九に、**業法ガード設計**: shiwake-ai は「CSV出力する計算補助ツール」、確定行為は会計ソフトで人間が行う

---

## 💡 重要な戦略レイヤー

### 2モデル併売構造

#### AI SaaS版(廉価帯・継承)
- 5プラン: ライト〜チームプレミアム(¥980〜¥100,000/月)
- 月額固定
- インセンティブ機能あり

#### Agent版(高価格帯・新設)
- 4プラン: ライト〜エリート(¥30,000〜¥250,000/月)
- 件数従量(将来実装)
- 1事務所1ID(共有)
- インセンティブ機能なし(設計上不要)

### 代理店制度(階段制マージン)

| ランク | 月次取引高 | 卸売率 | マージン |
|---|---|---|---|
| 🥉 Bronze | 〜¥100,000 | 70% | 30% |
| 🥈 Silver | ¥100,001〜¥500,000 | 65% | 35% |
| 🥇 Gold | ¥500,001〜 | 60% | 40% |

ランク判定は前月の取引高ベース、Stripe Coupon を動的に適用して実現。

---

## ⚠️ 既知の課題・リスク

第一に、**Render Cron Job の有料化問題**: 月次ランク判定バッチを動かすには有料プラン必要

第二に、**Stripe webhook が動かず plan_key NULL**: 「警告ログ」を実装済み

第三に、**マネーフォワード仕訳API未公開**: Phase 2 は CSV+フォルダで対応、v3.0.0 で API 連携検討

第四に、**Elite販売開始タイミング**: 戦略未確定(v3.1.0 実装後? 先行予約?)

第五に、**第14条業法ガード崩壊リスク**: UI で確定機能を追加しない設計を維持

---

## 📚 関連ドキュメント

| ファイル | 内容 |
|---|---|
| `docs/shiwake-ai_引き継ぎ_v1_3_1.md` | v1.x 時代(コスト最適化等) |
| `docs/shiwake-ai_引き継ぎ_v2_1_0.md` | Agent Elite 新設・5階層キャリアパス |
| `docs/shiwake-ai_引き継ぎ_v2_2_1.md` | プラン体系完成、本日の包括的引き継ぎ(766行・60TODO) |
| `docs/shiwake-ai_v2_2_0_仕様書.md` | v2.2.0 実装仕様書(改訂6) |
| `legal/shiwake-ai_代理店規約_v1_0_draft.md` | 代理店規約初版(履歴用) |
| `legal/shiwake-ai_代理店規約_v1_4_draft.md` | 代理店規約最新版(現役) |
| `pr-agent/shiwake-ai-PR-Agent_実装指示書_v3_骨組み.md` | PR Agent v3 骨組み(現役主参照) |

---

## 🎬 新しいチャットでの最初の動き

### Step 1: 状況確認

新しいチャットで以下を実行(またはユーザーから状況聞き取り):

```bash
cd ~/APP/shiwake-ai
git status
git log --oneline -3
ls pr-agent/brain/
```

### Step 2: 次の作業の確認

ユーザーに何から始めるか聞く:

第一に、**PR Agent T1-6 Writer ノード続行**(本筋)
第二に、**他のタスクが優先**(状況次第)
第三に、**新しい相談**(別の問題発生)

### Step 3: 作業開始

ユーザー対話ルール(コードを書く前に承認、セルフチェック5回、トークン節約等)を守って進める。

---

## 🌟 本日の達成サマリー

```
git コミット: 5回
作成ドキュメント: 9本(規約5、引き継ぎ1、PR Agent v3骨組み1、AI法務プロンプト4)
3AIレビュー: 4ラウンド完遂
実装規模: 数百行のコード追加(Stripe、Supabase、PR Agent)

通常スタートアップなら 1.5ヶ月分の作業 → 1日で完遂
```

---

**作成日**: 2026年5月9日(土)
**作成者**: 和泉大介(指示) + Web版Claude(実行)
**前セッション**: 5月8〜9日連続作業(超長時間セッション)
**次セッション**: PR Agent T1-6(Writer ノード)実装から再開予定

---

# このドキュメントを新しいチャットの最初に貼ってスタート 🚀
