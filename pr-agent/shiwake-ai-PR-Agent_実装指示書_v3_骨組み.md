# shiwake-ai-PR Agent 実装指示書 v3.0(骨組み)

> 本ファイルは v3 の構造確認用。詳細(コード雛形・SQL・プロンプト全文)は骨組み確定後に追記。
> 作成: 2026-05-08 / 指示出し: Claude chat / 実装: claude code
>
> **v2 → v3 の変更点**: Anthropic Cowork(DSKさんの Claude Pro/Max 契約に既に含まれる)を運用補助として組み込み、Phase 4(営業ツール)を Cowork で代替する形で実装工数を削減。

---

## 0. claude code への申し送り
- トークン節約最優先(着手前に確認)
- 5回セルフチェック → push
- `cd ~/APP/shiwake-ai/pr-agent` 後、ディレクトリ移動を挟まず git一括
- shiwake-ai設計思想「判断の見える化」を PR Agent側にも適用
- **Cowork は DSKさん側で動かす**(claude code の実装範囲外。本ドキュメントの 🖥 マーク部分)
- **Cowork に渡す指示書は Phase 1 完了後に別途作成**

---

## 1. プロジェクト概要
- 名称: shiwake-ai-PR Agent / 外向き「証憑仕訳AI Agent」
- 目的: shiwake-ai.com の認知拡大・ユーザー獲得・代理店開拓
- 性格: 外面プロ(信頼性)×内面ドタバタ(ユーモア0.8/ドタバタ0.9/衝撃0.6/真面目0.7)
- ターゲット2方向: SNS自律運用 + toB/toC営業ツール
- 開発期間: **3.5〜4週間想定**(v2 の 5週間 → Cowork 代替で約1〜1.5週間短縮)

---

## 2. 確定技術構成
| レイヤー | 採用 | 区分 |
|---------|-----|------|
| 言語 | Python 3.12+ | 🤖 Cloud Run側 |
| 実行環境 | Cloud Run(月$5〜$20想定) | 🤖 |
| データストア | Supabase(DB + Storage + pgvector) | 🤖 |
| Agent FW | LangGraph | 🤖 |
| LLM(Cloud Run側) | Claude Sonnet 4.6 / Opus 4.7 | 🤖 |
| ブラウザ自動化 | Playwright(Cloud Run側) | 🤖 |
| 画像処理 | Pillow / OpenCV(必要に応じ) | 🤖 |
| 通知 | LINE Notify or Discord Webhook | 🤖 |
| 公開フロー | 初期承認制 → 段階的自動化解禁 | 🤖 |
| **運用補助** | **Anthropic Cowork(Claude Pro/Maxに含む、追加コストなし)** | **🖥 DSKさん側** |
| **Adobe MCP連携** | **画像生成・編集に活用(既契約)** | **🖥 Cowork経由** |

### 凡例(本ドキュメント全体で使用)
```
🤖 Cloud Run Agent  = LangGraph で動く 24時間自律本体
👨‍💻 Claude Code      = ローカルでコード実装(本実装指示書の対象)
🖥 Cowork           = DSKさんの Mac で動く AI 同僚(別指示書で運用)
👤 DSKさん本人       = 手動操作(Cowork で削減対象)
```

---

## 3. Agent 7ノード構成(Cloud Run側)

```
TrendWatcher → Planner → MaterialScout → Writer → Publisher → Analyst
                                                       ↓
                                                    Panic
        ↑↓ Memory Bank (Supabase)
```

| ノード | 責務 | 実行 |
|-------|-----|------|
| ① TrendWatcher | 競合・税制・トレンド監視(外部情報) | 🤖 |
| ② Planner | 今日のネタ・ペルソナ・構文・キャラ・時間帯を決定 | 🤖 |
| ③ MaterialScout | 必要素材の在庫確認 → 無ければ生成依頼 | 🤖(在庫検索) / 🖥(画像生成は Cowork+Adobe MCP に投げる選択肢) |
| ④ Writer | キャラ×構文×3軸トリガーで原稿生成 | 🤖 |
| ⑤ Publisher | 承認後、各SNSへ配信(X以外) | 🤖 |
| ⑥ Analyst | 反応取得(30min/3h/24h)+ 要因分析 | 🤖(自動API) / 🖥(X はCoworkで取得) |
| ⑦ Panic | バズ検知時のセルフリプライ + パニック投稿提案 | 🤖 |

---

## 4. 設計の3軸(変更なし)

### 軸A: ペルソナ(誰に)
| ID | ターゲット | 訴求軸 | ベスト投稿時間 |
|----|----------|-------|--------------|
| P1 | 個人/フリラン | 時短・980円・スマホスキャン | 21:00-23:00 |
| P2 | 中規模会社(スタッフ層) | インセンティブ・ゲーム化 | 12:00-13:00 / 18:00 |
| P3 | 中規模会社(経営者層) | 教育コスト削減・自律化 | 8:00-9:00 / 17:00 |
| P4 | 税理士事務所 | マスタ学習・顧問先管理 | 8:00-9:00 / 20:00 |

### 軸B: キャラクター(誰が話す)
- shoyo_kun(ドタバタ男子)/ shoyo_chan(ドタバタ女子)
- zeirishi_sensei(真面目男性)/ keiri_san(共感女性)/ shacho(関西弁おっちゃん)
- 各キャラに性格パラメーター5種を保持

### 軸C: 戦略(どう攻める)
- **構文ウェポン6種**: W1常識破壊 / W2比較 / W3専門知識 / W4エモ独白 / W5巻き込み / W6パニック
- **拡散トリガー3軸**(構文と直交・Gemini採用): Antagonism / Altruism / Storytelling

→ Plannerが「P4×zeirishi_sensei×W3×Altruism×8:00投稿」のように4軸で組み合わせを決定

---

## 5. 対応SNSとPhase別範囲

### SNS別の運用方針(v3で更新)

| SNS | 優先度 | 認証/制約 | v3 運用方針 |
|-----|-------|---------|-----------|
| Threads | ★★★ | Meta公式API/無料 | 🤖 自動配信 |
| X | ★★★ | API契約せず | **👤 DSKさん手動 + 🖥 Cowork 補助**(パッチ#001 + Cowork強化) |
| Instagram | ★★ | Graph API/画像必須 | 🤖 自動配信 |
| note | ★★ | API無し | **🖥 Cowork で代替**(Playwright実装の代替案・規約確認後) |
| Zenn | ★ | GitHub連携で記事更新 | 🤖 自動(GitHub経由) |
| Qiita | × | 後回し | - |

### Phase 別範囲(v3で工数調整)

| Phase | Week | 対応範囲 |
|-------|------|---------|
| Phase 1 | 1-2 | Threads / Writer + 承認 / Memory Bank基盤 / X手動投稿基盤 |
| Phase 2 | 3 | Instagram + Analyst + MaterialScout + 🖥 X 計測の Cowork 化 |
| Phase 3 | 4 | note(Cowork併用) + Panic + 自動化解禁ロジック + TrendWatcher |
| Phase 4 | 5(短縮) | Zenn + 🖥 営業ツール(Cowork で代替) + ダッシュボード強化 |

---

## 6. ディレクトリ構成(v2 とほぼ同じ、`sales/` の扱いだけ変更)

```
~/APP/shiwake-ai/pr-agent/
├── brain/                       # 判断ロジック(🤖)
│   ├── trend_watcher.py
│   ├── planner.py
│   ├── material_scout.py
│   ├── writer.py
│   ├── analyst.py
│   ├── panic.py
│   ├── personalities/           # キャラ5体の性格定義
│   ├── weapons/                 # 構文6種のプロンプト
│   └── triggers/                # 3軸トリガーの修飾子
├── connectors/                  # 外部API(🤖)
│   ├── meta_api.py              # Threads + Instagram統合
│   ├── note_api.py              # ※v3では Cowork併用 / Playwright自動化は最小実装
│   ├── zenn_api.py              # GitHub経由
│   └── (mail_sender.py は v3 で削除 → Cowork に移譲)
├── visuals/                     # 画像処理(🤖)
│   ├── ui_annotator.py
│   ├── ogp_generator.py
│   ├── screenshot_capture.py    # Playwright撮影
│   ├── character_compositor.py  # キャラ画像合成
│   └── raw/                     # 12枚＋自動撮影分
├── memory/
│   ├── supabase_client.py
│   ├── schema.sql               # 🤖
│   └── git_log_harvester.py     # ★ 実績ゼロ期戦略(Geminiから採用)
├── notify/
│   └── line.py
├── cowork_handoff/              # ★ v3新設: Coworkに渡す指示書を集約
│   ├── README.md                # Coworkを使う運用ガイド
│   ├── morning_review.md        # 朝の3案レビュー指示書
│   ├── x_manual_post.md         # X手動投稿補助の指示書
│   ├── x_metrics_collect.md     # X 24h計測の指示書
│   ├── monthly_report.md        # 月次レポート作成指示書
│   ├── lead_finder.md           # 営業リード探索の指示書
│   └── outreach_writer.md       # 営業メール下書きの指示書
├── dashboard/                   # 承認画面(FastAPI + 軽量UI)
├── config/
│   ├── personas.yaml
│   ├── characters.yaml
│   ├── weapons.yaml
│   ├── triggers.yaml
│   └── time_table.yaml
├── main.py                      # 統括ループ
└── pyproject.toml
```

### v2 → v3 のディレクトリ差分

| 変更 | 内容 |
|---|---|
| **削除** | `connectors/mail_sender.py`(Cowork で代替) |
| **削除** | `sales/` ディレクトリ(Cowork で代替) |
| **新設** | `cowork_handoff/` ディレクトリ(Cowork 用指示書集約) |
| **縮小** | `connectors/note_api.py` を最小実装に(Cowork 併用) |

---

## 7. Memory Bank スキーマ(v2 と同じ)

| テーブル | 用途 |
|---------|-----|
| posts | 全投稿履歴 + retry_of 系譜 |
| engagements | 30min/3h/24h 計測 |
| memory_bank | 要因分析・next_action記録 |
| visual_assets | 画像カタログ |
| success_patterns | 構文×ペルソナ×キャラの勝ちパターン |
| trends | TrendWatcherの検知ログ |
| **leads** | 営業リード(v3では Cowork が書き込み)|
| **outreach_history** | 営業履歴(v3では Cowork が書き込み)|
| incentive_events | shiwake-ai本体からのインセンティブ通知 ★ |
| git_commits | DSKさんのコミット履歴を素材化 ★ |

★ = Gemini採用項目

### v3 でのスキーマ変更

posts テーブルに`status='awaiting_manual_post'` 追加(パッチ#001継承):

```sql
-- パッチ#001継承
status text not null default 'draft',
-- 'draft' | 'approved' | 'awaiting_manual_post' | 'published' | 'rejected'

alter table posts add column manual_posted_at timestamptz;
alter table posts add column manual_posted_url text;
```

leads / outreach_history は v3 でも維持(Cowork が書き込む先として使用)。

---

## 8. v3 で Cowork が担当する作業(完全リスト)

### 8.1 Phase 1 で導入する Cowork 作業

| 作業 | 頻度 | Cowork 指示書 |
|---|---|---|
| **12枚画像のSupabase登録 + visual_assets投入** | 1回(初期) | `cowork_handoff/visuals_setup.md`(別途作成) |
| **画像のぼかし加工(Image 4, 9)** | 1回(初期) | 同上 |
| **朝の3案レビュー支援**(評価軸まとめ) | 毎日 | `cowork_handoff/morning_review.md` |
| **X 手動投稿の補助**(原稿コピー→投稿画面起動→画像添付→URL貼り戻し) | 投稿ごと | `cowork_handoff/x_manual_post.md` |

### 8.2 Phase 2 で追加する Cowork 作業

| 作業 | 頻度 | Cowork 指示書 |
|---|---|---|
| **X の24h計測**(Xアナリティクスから取得) | 投稿24h後 | `cowork_handoff/x_metrics_collect.md` |
| **画像生成依頼**(Adobe MCP連携で生成) | 必要時 | `cowork_handoff/visual_generation.md`(別途作成) |

### 8.3 Phase 3 で追加する Cowork 作業

| 作業 | 頻度 | Cowork 指示書 |
|---|---|---|
| **note 投稿補助**(Playwrightで自動化する代わりに Cowork が代行) | 記事ごと | `cowork_handoff/note_post.md`(別途作成) |

### 8.4 Phase 4 で完全に Cowork 化する作業

| 作業 | 頻度 | Cowork 指示書 |
|---|---|---|
| **営業リード探索**(税理士事務所の Web 検索 → 一覧化) | 月次/オンデマンド | `cowork_handoff/lead_finder.md` |
| **営業メール下書き**(各リードにカスタマイズ) | リードごと | `cowork_handoff/outreach_writer.md` |
| **月次レポート作成**(Memory Bank → スプレッドシート) | 月次 | `cowork_handoff/monthly_report.md` |

### 8.5 Cowork に渡す情報の仕組み

Cowork は以下のリソースにアクセスする想定:

```
ローカル:
├── ~/APP/shiwake-ai/pr-agent/cowork_handoff/   ← 指示書群
└── ~/APP/shiwake-ai/pr-agent/dashboard/output/ ← Cowork が読み書きするバッファ

外部:
├── PR Agent ダッシュボード(http://localhost:8000)
├── Supabase(MCP連携可能なら直接、不可なら API経由)
├── X(ブラウザ自動化)
├── note(ブラウザ自動化)
└── Adobe MCP(画像生成)
```

### 8.6 Cowork 利用上のリスク管理(継承事項)

第一に、**Stripe 関連の操作は Cowork に渡さない**(プロンプトインジェクション攻撃リスク)
第二に、**顧客個人情報の処理は Cowork に渡さない**
第三に、**Anthropic 自身が「センシティブデータを扱うアプリと同時使用するな」と推奨**(2026年4月時点)
第四に、**API キーは Cowork に渡さない**(環境変数のまま、Cloud Run側で保持)

---

## 9. Gemini採用6項目の実装位置(v2 から継承)

| # | 項目 | 実装位置 | v3 変更 |
|---|------|---------|--------|
| A | 実績ゼロ期戦略(Gitログ素材化) | `memory/git_log_harvester.py` + Plannerが参照 | 変更なし |
| B | ペルソナ別最適時間帯 | `config/time_table.yaml` + Planner | 変更なし |
| C | 拡散トリガー3軸 | `brain/triggers/` + Writerに修飾子注入 | 変更なし |
| D | パニック時セルフリプライ | `brain/panic.py` を2段構え | 変更なし |
| E | インセンティブ連動 | shiwake-ai本体→Webhook→`incentive_events`テーブル→Plannerが祝福投稿企画 | 変更なし |
| F | 競合言及ガードレール | Writerシステムプロンプトに明記 | 変更なし |

---

## 10. 重要なリーガル/リスクガードレール(v2 から継承 + Cowork 関連追加)

### v2 から継承
- **競合社名禁止**(freee/マネフォ/弥生の社名は出さない)
  - OK: 「従来のクラウド会計ソフトでは…」
  - NG: 「freeeでは…」「マネフォでは…」
- **税法の具体数値・条文**: 必ず根拠URL + 「不確実なら出さない」
- **note Playwright**: Phase 3着手前に規約再確認(v3 では Cowork 併用検討)
- **デモアカウント**: 本番DBに `is_demo: true` フラグ追加し統計から除外
- **公開12枚画像**: Image 4(Agent価格)と Image 9(店名)はぼかし加工

### v3 で追加
- **Cowork 利用範囲の制限**:
  - 機密性の低い作業のみ(SNS投稿補助・リード探索・レポート作成)
  - Stripe / 顧客個人情報 / API キーは Cowork に渡さない
- **Cowork 指示書の作成タイミング**:
  - Phase 1 完了後に最初の指示書作成
  - 各 Phase で必要になった時点で追加

---

## 11. Phase 1 タスク(Week 1-2)

### Week 1
- T1-1: Cloud Run + Supabase 環境構築 👨‍💻
- T1-2: `memory/schema.sql` 適用(最小: posts/engagements/memory_bank/visual_assets) 👨‍💻
- T1-3: `config/` YAML 5本作成(personas/characters/weapons/triggers/time_table) 👨‍💻
- T1-4: ~~12枚をSupabase Storageへ + visual_assets登録~~ → **Phase 1完了後に Cowork で実施 🖥**
- T1-5: ~~ui_annotator.py で12枚一括検証~~ → **Phase 1完了後に Cowork で実施 🖥**
- T1-6: Writer ノード(キャラ×構文×トリガーの3軸プロンプト合成) 👨‍💻

### Week 2(パッチ#001 適用後の v2.1 を継承)
- T2-1: Threads APIコネクタ 👨‍💻 (X はパッチ#001で削除済)
- T2-2: Publisher 実装 + 承認連動(X分岐含む) 👨‍💻
- T2-3: 承認ダッシュボード(FastAPI + Tailwind 簡易版、X用コピーUI追加) 👨‍💻
- T2-4: LINE/Discord 通知 👨‍💻
- T2-5: Planner(Gitログ素材化 + 時間帯テーブル参照) 👨‍💻
- **T2-6: Cowork 指示書作成: `cowork_handoff/morning_review.md` と `x_manual_post.md`** 👨‍💻+🖥(v3新設)

### Phase 1 完了の定義
1. 「DSKさんが朝LINE通知を受けて、3案からスマホで1案承認 → Threadsに投稿される」が動く
2. **🖥 Cowork が朝のレビュー支援と X 手動投稿補助を担当できる状態**(v3新設)

### v2 → v3 の Phase 1 工数差
- T1-4, T1-5: 1日減(Cowork に移譲)
- T2-6: 0.5日増(Cowork 指示書作成)
- **正味: 0.5日減**

---

## 12. Phase 2-4 概要(v3 で工数再調整)

### Phase 2 (Week 3): Instagram + Analyst
- Instagram API コネクタ 👨‍💻
- Analyst(30min/3h/24h計測、Threads + Instagram のみ自動)👨‍💻
- MaterialScout(画像在庫検索 → 無ければ Cowork+Adobe MCP に依頼)👨‍💻+🖥
- **🖥 Cowork 指示書作成: `x_metrics_collect.md`, `visual_generation.md`** 👨‍💻

### Phase 3 (Week 4): note + Panic
- note 投稿: **Cowork 併用方式**(Playwright 自動化は最小実装、複雑な処理は Cowork に投げる)👨‍💻+🖥
- Panic(セルフリプライ含む) 🤖
- TrendWatcher 🤖
- 自動化解禁ロジック 🤖
- **🖥 Cowork 指示書作成: `note_post.md`** 👨‍💻

### Phase 4 (Week 5・短縮): Zenn + 営業ツール
- Zenn 連携(GitHub経由) 👨‍💻
- ~~lead_finder.py 実装~~ → **🖥 Cowork で代替(実装不要)** 工数 3〜5日 → 0.5日
- ~~outreach_writer.py 実装~~ → **🖥 Cowork で代替(実装不要)** 工数 3〜5日 → 0.5日
- ~~月次レポート機能~~ → **🖥 Cowork で代替(実装不要)** 工数 1〜2日 → 0.5日
- **🖥 Cowork 指示書作成: `lead_finder.md`, `outreach_writer.md`, `monthly_report.md`** 👨‍💻
- ダッシュボード強化(Cowork が読み書きしやすい構造に)👨‍💻

### v3 全体の工数差(v2 比)
- Phase 1: 0.5日減
- Phase 2: ±0(Cowork指示書追加で相殺)
- Phase 3: 1〜1.5日減(note Playwright が最小実装に)
- **Phase 4: 5〜7日減(営業ツール完全代替)**
- **合計: 約 1〜1.5週間短縮**

---

## 13. 完成イメージ(DSKさんの1日)v3

```
朝9:00  🤖 Cloud Run Agent: ネタ生成・3案作成
朝9:05  🤖 → 📲 LINE「今日のネタ3案できました」
朝9:06  👤 DSKさん、Mac の前で 🖥 Cowork に「3案レビュー手伝って」
朝9:07  🖥 Cowork: ダッシュボード読み込み → 3案を表で整理 → 評価
朝9:08  👤 DSKさん 1案承認 → 🤖 Threads に自動投稿 + X は status='awaiting_manual_post'
朝9:09  👤 DSKさん「X の投稿もやって」
朝9:10  🖥 Cowork: 原稿コピー → X 投稿画面起動 → 画像添付 → 投稿 → URL貼り戻し
朝9:12  ✅ 朝の運用完了(所要時間 7分)

昼12:00 🤖 Threads でバズ検知 → 🤖 Panic 起動 → セルフリプライ案
昼12:01 📲 LINE「Threadsバズってます…(動揺)」→ 👤 DSKさんタップ承認 → 🤖 自動配信

夕18:00 👤 DSKさん「今週の税理士リード10件、Cowork に探させて」
夕18:01 🖥 Cowork: Web検索 → 各事務所分析 → カスタマイズメール下書き作成 → スプレッドシート整理
夕18:30 👤 DSKさん レビュー後、メール送信(または Cowork に依頼)

夜21:00 📲 LINE「本日レポート: リーチ12,800 / 新規45 / W4×keiri_sanが今日の勝者」
       → 必要なら 🖥 Cowork に「詳細分析して」と依頼
```

DSKさんの1日の合計操作時間:
- v2 計画: 約 30〜45分
- **v3 計画: 約 10〜15分**(Cowork が大幅に補助)

---

## 14. claude code への最初の一言(DSKさん→claude code)v3

> この `shiwake-ai-PR-Agent_実装指示書_v3.md` を読んで、Phase 1 T1-1 から順に進めてください。
> 着手前に必ず私(DSK)に「これから○○を作ります」と確認。
> 5回見直しでpush。トークン節約。
>
> 【v2 → v3 の主な変更】
> - X は手動投稿(パッチ#001継承)
> - **Cowork が運用補助として参加**(claude code の実装範囲外、🖥 マークで識別)
> - **Phase 4 の営業ツール(lead_finder/outreach_writer)は実装不要**(Cowork で代替)
> - cowork_handoff/ ディレクトリに Cowork 用指示書を集約
>
> 不明点はClaude chat(指示出し役)に相談OK。

---

## 15. v2 → v3 の差分サマリー

| 項目 | v2 | v3 |
|---|---|---|
| **開発期間** | 5週間 | **3.5〜4週間** |
| **追加コスト** | Cloud Run + API 増分 | **同じ**(Cowork は既契約に含む) |
| **DSKさん日次作業** | 30〜45分 | **10〜15分** |
| **Phase 4 工数** | 5〜7日 | **0.5〜1日**(Cowork で代替) |
| **note 自動化** | Playwright 完全実装 | Cowork 併用(規約リスク低減) |
| **X 計測** | 手動入力 | Cowork 自動化 |
| **画像整理** | コード実装 | Cowork に移譲 |
| **月次レポート** | コード実装 | Cowork で代替(実装不要) |
| **新設ディレクトリ** | なし | `cowork_handoff/`(Cowork指示書集約) |
| **削除** | なし | `connectors/mail_sender.py`, `sales/` |

---

# v3 骨組みここまで。

> 確認後の流れ:
> 1. v3 骨組みを承認 → claude code に渡す前に Cowork 指示書テンプレートを別途作成(Phase 1 完了後)
> 2. Phase 1 着手は v3 骨組みのまま開始可能(Cowork 指示書は Phase 1 後半で作成)
> 3. 各セクションの詳細(コード雛形・SQL全文・プロンプト全文)は v2 と同じく骨組み確定後に肉付け

---

**作成日**: 2026年5月8日
**作成者**: 和泉大介(指示) + Web版Claude(原案)
**前バージョン**: v2.0(2026-05-08) + パッチ#001(同日)
**Phase 1 着手予定**: 未定(明日以降の判断で)
