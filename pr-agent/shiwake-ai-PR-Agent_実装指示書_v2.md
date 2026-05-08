# shiwake-ai-PR Agent 実装指示書 v2.0（完成版）

> **claude code への引き継ぎ文書 / 最終版**
> 作成日: 2026-05-08
> 指示出し: Claude chat / 実装: claude code
> プロジェクトルート: `~/APP/shiwake-ai/pr-agent/`
>
> **構成**: 概要（本パート）+ Part A（データ基盤）+ Part B（設定とPhase 1）+ Part C（デプロイと申し送り）

---

## 0. claude code への申し送り（最重要・先に読む）

このプロジェクトは **DSKさん（PM）→ Claude chat（指示出し）→ claude code（実装）** の3者体制で進める。

### 開発ルール（厳守）

1. **トークン節約最優先**: 大規模な変更・新規ファイル作成の前に必ず DSKさんに承認を取る。「これから○○を作ります、よろしいですか？」のひと声。
2. **5回セルフチェック**: コミット前に「間違い・漏れ・矛盾」を最低5回確認してから push する。
3. **デプロイコマンドの作法**: `cd ~/APP/shiwake-ai/pr-agent` の後、ディレクトリ移動を挟まず、`git add` → `commit` → `push` を1ブロックで出す。
4. **shiwake-aiの設計思想**: 「判断の見える化でユーザーが自分のツールを育てている感覚」を本PR Agent側にも適用する。AgentがなぜこのキャラとW3を選んだか、DSKさん本人にも見える形で残すこと。

### 参照ドキュメントと優先順位

このファイル単体で完結するように構成している。Part A → B → C の順に読むこと。

---

## 1. プロジェクト概要

| 項目 | 内容 |
|------|------|
| 名称 | shiwake-ai-PR Agent |
| 外向き名称 | 証憑仕訳AI Agent |
| 目的 | shiwake-ai.com の認知拡大・ユーザー獲得・代理店（税理士事務所）開拓 |
| 性格 | 外面プロ（信頼性）×内面ドタバタ（ユーモア0.8/ドタバタ0.9/衝撃0.6/真面目0.7） |
| ターゲット2方向 | SNS自律運用 + toB/toC営業ツール（Phase 4） |
| 開発期間 | 5週間想定（Phase 1〜4） |

### shiwake-ai本体の現状（接続先）

- 本番: https://shiwake-ai.com/ (独自ドメイン稼働中)
- バックアップ: https://shiwake-ai.onrender.com/
- リポジトリ: https://github.com/nice-gecko/shiwake-ai
- 技術: Node.js + Render、Supabase、Firebase Auth、Stripe、Anthropic API
- ローカルパス: `~/APP/shiwake-ai`

PR Agent はこの本体の隣接プロジェクトとして `~/APP/shiwake-ai/pr-agent/` に配置する。

---

## 2. 確定技術構成

| レイヤー | 採用 |
|---------|-----|
| 言語 | Python 3.12+ |
| 実行環境 | **Cloud Run + Cloud Scheduler**（月$5〜$20想定） |
| データストア | **Supabase**（DB + Storage + 将来pgvector） |
| Agent FW | LangGraph |
| LLM | Claude Sonnet 4.6（通常）/ Opus 4.7（重要判断） |
| ブラウザ自動化 | Playwright |
| 画像処理 | Pillow / OpenCV |
| 通知 | LINE Notify or Discord Webhook（DSKさん選択） |
| 公開フロー | **初期承認制 → 段階的自動化解禁** |

### 重要な決定事項

- **Vercel ではなく Cloud Run** を採用（画像処理ライブラリの強さでPython優先）
- 1日1スロットから始める（Phase 1のMVP）
- 12枚の手動UI画像をベースに、Playwrightで本番デモアカウントから追加撮影

---

## 3. Agent 7ノード構成

```
TrendWatcher → Planner → MaterialScout → Writer → Publisher → Analyst
                                                        ↓
                                                      Panic
        ↑↓ Memory Bank (Supabase)
```

| ノード | 責務 |
|-------|-----|
| ① TrendWatcher | 競合・税制・トレンド監視（外部情報） |
| ② Planner | 今日のネタ・ペルソナ・構文・キャラ・時間帯を決定 |
| ③ MaterialScout | 必要素材の在庫確認 → 無ければ生成依頼 |
| ④ Writer | キャラ × 構文 × 3軸トリガーで原稿生成 |
| ⑤ Publisher | 承認後、各SNSへ配信 |
| ⑥ Analyst | 反応取得（30min/3h/24h）+ 要因分析 |
| ⑦ Panic | バズ検知時のセルフリプライ + パニック投稿提案 |

---

## 4. 設計の3軸 + 拡散トリガー

### 軸A: ペルソナ（誰に） — 4種

| ID | ターゲット | 訴求軸 |
|----|----------|-------|
| P1 | 個人/フリラン | 時短・980円・スマホスキャン |
| P2 | 中規模会社（スタッフ層） | インセンティブ・ゲーム化 |
| P3 | 中規模会社（経営者層） | 教育コスト削減・自律化 |
| P4 | 税理士事務所 | マスタ学習・顧問先管理 |

### 軸B: キャラクター（誰が話す） — 5種

shoyo_kun / shoyo_chan / zeirishi_sensei / keiri_san / shacho

各キャラに性格パラメーター5種（humor / shock / slapstick / seriousness / voice）を保持。詳細は Part B B-2。

### 軸C: 戦略構文（どう攻める） — 6種

| ID | 構文 | 用途 |
|----|------|------|
| W1 | 常識破壊 | 「まだ〇〇してるんですか？」 |
| W2 | 比較構造 | Before/Afterリスト |
| W3 | 専門知識 | プロのTips提供 |
| W4 | エモ独白 | 開発の裏側・人間味 |
| W5 | 巻き込み | 問いかけ・会話発生 |
| W6 | パニック | バズ時のみ |

### 拡散トリガー3軸（Gemini採用、構文と直交）

Antagonism（対立構造）/ Altruism（利他性）/ Storytelling（物語性）

→ Plannerが「P4 × zeirishi_sensei × W3 × Altruism × 8:00投稿」のように4軸+時間で組み合わせを決定。

---

## 5. 対応SNSとPhase別範囲

| SNS | 優先度 | 認証/制約 |
|-----|-------|---------|
| Threads | ★★★ | Meta公式API/無料 |
| X | ★★★ | Basic $200/月（要予算判断） |
| Instagram | ★★ | Graph API/画像必須 |
| note | ★★ | API無し→Playwright（規約注意） |
| Zenn | ★ | GitHub連携で記事更新 |
| Qiita | × | 後回し |

| Phase | Week | 対応範囲 |
|-------|------|---------|
| Phase 1 | 1-2 | Threads + X / Writer + 承認 / Memory Bank基盤 |
| Phase 2 | 3 | Instagram + Analyst + MaterialScout |
| Phase 3 | 4 | note + Panic + 自動化解禁ロジック + TrendWatcher |
| Phase 4 | 5 | Zenn + 営業ツール連携 + ダッシュボード |

---

## 6. ディレクトリ構成

```
~/APP/shiwake-ai/pr-agent/
├── brain/                       # 判断ロジック
│   ├── trend_watcher.py
│   ├── planner.py
│   ├── material_scout.py
│   ├── writer.py
│   ├── publisher.py
│   ├── analyst.py
│   └── panic.py
├── connectors/                  # 外部API
│   ├── x_api.py
│   ├── meta_api.py              # Threads + Instagram統合
│   ├── note_api.py              # Playwright
│   ├── zenn_api.py              # GitHub経由
│   └── mail_sender.py           # 営業メール
├── visuals/                     # 画像処理
│   ├── ui_annotator.py
│   ├── ogp_generator.py
│   ├── screenshot_capture.py    # Playwright撮影
│   ├── character_compositor.py  # キャラ画像合成
│   └── raw/                     # 12枚＋自動撮影
├── memory/
│   ├── supabase_client.py
│   ├── schema.sql
│   └── git_log_harvester.py     # Gemini採用A・実績ゼロ期戦略
├── notify/
│   └── line.py                  # or discord.py
├── sales/                       # 営業ツール（Phase 4）
│   ├── lead_finder.py
│   └── outreach_writer.py
├── dashboard/                   # 承認画面（FastAPI + Jinja2）
├── config/
│   ├── personas.yaml
│   ├── characters.yaml
│   ├── weapons.yaml
│   ├── triggers.yaml
│   └── time_table.yaml
├── main.py                      # FastAPI統括
├── Dockerfile
├── pyproject.toml
└── .env.example
```

---

## 7. Gemini採用6項目の実装位置

Geminiとのディスカッションで採用した6項目の実装位置：

| # | 項目 | 実装位置 |
|---|------|---------|
| A | 実績ゼロ期戦略（Gitログ素材化） | `memory/git_log_harvester.py` + Plannerが参照 |
| B | ペルソナ別最適時間帯 | `config/time_table.yaml` + Planner |
| C | 拡散トリガー3軸 | `config/triggers.yaml` + Writerに修飾子注入 |
| D | パニック時セルフリプライ | `brain/panic.py` を2段構え |
| E | インセンティブ連動 | shiwake-ai本体→Webhook→`incentive_events`テーブル→Planner |
| F | 競合言及ガードレール | Writer SYSTEM_PROMPT_BASE に明記 |

---

## 8. 重要なリーガル/リスクガードレール

- **競合社名禁止**（freee/マネフォ/弥生/勘定奉行）
- **税法の具体数値・条文を出すときは根拠URL** + 不確実なら出さない
- **note Playwright**: Phase 3着手前に規約再確認
- **デモアカウント**: 本番DBに `is_demo: true` フラグ追加し統計から除外
- **公開12枚画像**: Image 4（Agent価格）と Image 9（店名）はマスキング

---

## 9. Phase 1 タスク一覧（詳細はPart B B-7）

### Week 1
- T1-1: Cloud Run + Supabase 環境構築
- T1-2: Supabase スキーマ適用
- T1-3: config/ YAML 5本作成
- T1-4: 12枚をSupabase Storageへ + visual_assets登録
- T1-5: ui_annotator.py で12枚一括検証
- T1-6: Writer ノード実装

### Week 2
- T2-1: X API コネクタ
- T2-2: Threads API コネクタ
- T2-3: Publisher 実装 + 承認連動
- T2-4: 承認ダッシュボード
- T2-5: LINE/Discord 通知
- T2-6: Planner 実装（Git素材化 + 時間帯テーブル参照）

### Phase 1 完了の定義

「DSKさんが朝LINE通知を受けて、3案からスマホで1案承認 → Threadsに投稿される」が**5分以内**に動く。

---

## 10. 完成イメージ（DSKさんの1日）

```
朝 9:05  LINE「今日のネタ3案できました」
         → スマホで開く → 1案選んでタップ承認
         → X / Threads に投稿される

昼12:00 LINE「Threadsの投稿、reach 5000超えました…！(動揺)」
        → DSKさん「OK、続報出していいよ」とタップ
        → パニック構文の続報投稿が公開される

夕18:00 LINE「税理士事務所10件のリードに営業メール下書きできました」
        → レビュー（Phase 4）

夜21:00 LINE「本日のレポート: 投稿3件、リーチ計12,800、
              新規フォロワー+45、W4×keiri_sanが今日の勝者でした」
```

---

## 11. claude code への最初の指示文（コピペ用・決定版）

DSKさんがこの指示書を `~/APP/shiwake-ai/pr-agent_実装指示書_v2.md` に保存した上で、claude code に以下を送る：

```
@claude code

これから shiwake-ai-PR Agent を開発します。

【最重要ルール】
1. トークン節約: 大規模な変更・新規ファイル作成の前に必ず私（DSK）に承認を取ってください。
   「これから○○を作ります、よろしいですか？」のひと声を入れる。
2. 5回セルフチェック: コミット前に間違い・漏れ・矛盾を最低5回確認してから push。
3. デプロイの作法: cd ~/APP/shiwake-ai/pr-agent の後、ディレクトリ移動を挟まず
   git add → commit → push を1ブロックで出してください。
4. 設計思想の継承: shiwake-ai 本体の「判断の見える化」をPR Agent側にも適用。
   AgentがなぜこのキャラとW3を選んだか、私本人にも見える形で残してください。

【参照ドキュメント】
~/APP/shiwake-ai/pr-agent_実装指示書_v2.md（このファイルの全体）

【最初のタスク】
Part C のセクション C-4「プロジェクト初期化コマンド集」を順に実行してください。
ただし、各ステップ着手前に「これから○○を実行します」と私に確認してください。

【不明点】
仕様や設計の判断で迷ったら Claude chat（指示出し役）に相談してOK。
コードの実装方法は claude code が判断してください。

準備ができたら「Phase 1 T1-1 を始めます」と宣言してから着手してください。
```

---

# 概要パートここまで。
# 以下、Part A → Part B → Part C の本体が続く。

---

# shiwake-ai-PR Agent 実装指示書 v2.0 - Part A
## データ基盤 + Pythonクラス雛形

> Part A は v2 の **データ層と Agent 7ノードのコード骨格**を定義する。
> Part B（YAML設定+Git素材化+完了基準）、Part C（環境変数+デプロイ+申し送り）と合わせて完成版になる。
> 作成: 2026-05-08

---

## A-1. Supabase スキーマ全文

このSQLを Supabase の SQL Editor にそのまま貼って実行する想定。

```sql
-- ============================================================
-- shiwake-ai-PR Agent  Memory Bank Schema v1
-- ============================================================

-- 拡張機能
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
-- 将来用（Phase 3以降の類似投稿検索）
-- create extension if not exists "vector";

-- ============================================================
-- 1. posts: 全投稿履歴
-- ============================================================
create table if not exists posts (
  id              uuid primary key default gen_random_uuid(),
  platform        text not null,                    -- 'x'|'threads'|'instagram'|'note'|'zenn'
  persona         text not null,                    -- 'P1'|'P2'|'P3'|'P4'
  character_id    text not null,                    -- 'shoyo_kun' 等
  weapon          text not null,                    -- 'W1'..'W6'
  trigger_axis    text,                             -- 'antagonism'|'altruism'|'storytelling'
  parameters      jsonb,                            -- 性格パラメーター実値
  content         text not null,                    -- 投稿本文
  media_asset_ids uuid[],                           -- visual_assets参照
  status          text not null default 'draft',    -- 'draft'|'approved'|'published'|'rejected'
  scheduled_at    timestamptz,
  published_at    timestamptz,
  external_id     text,                             -- SNS側の投稿ID
  external_url    text,                             -- 公開URL
  retry_of        uuid references posts(id),        -- 過去投稿への参照（Re-trial Strategy）
  parent_post_id  uuid references posts(id),        -- セルフリプライ時の親
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index idx_posts_status     on posts(status);
create index idx_posts_platform   on posts(platform, published_at desc);
create index idx_posts_persona    on posts(persona);

-- ============================================================
-- 2. engagements: 反応データ（30min/3h/24h）
-- ============================================================
create table if not exists engagements (
  id            uuid primary key default gen_random_uuid(),
  post_id       uuid not null references posts(id) on delete cascade,
  measured_at   timestamptz not null default now(),
  elapsed_min   int not null,                       -- 30 / 180 / 1440
  impressions   int default 0,
  likes         int default 0,
  comments      int default 0,
  shares        int default 0,
  saves         int default 0,                      -- Insta/Threadsで重要
  clicks        int default 0,                      -- URLリンクのクリック
  raw           jsonb,
  created_at    timestamptz default now()
);

create index idx_engagements_post on engagements(post_id, elapsed_min);

-- ============================================================
-- 3. memory_bank: 要因分析・next_action
-- ============================================================
create table if not exists memory_bank (
  id              uuid primary key default gen_random_uuid(),
  post_id         uuid references posts(id),
  content_theme   text,                             -- 'Staff Incentives' 等
  parameters      jsonb,                            -- 当該投稿の設定
  results_summary jsonb,                            -- {imp, save, neg_feedback}
  ai_analysis     text,                             -- LLMが書いた要因分析
  next_action     text,                             -- 次の改善アクション
  retry_lineage   uuid[],                           -- 系譜（A→B→Cと改善した履歴）
  created_at      timestamptz default now()
);

-- ============================================================
-- 4. visual_assets: 画像カタログ
-- ============================================================
create table if not exists visual_assets (
  id                    uuid primary key default gen_random_uuid(),
  storage_path          text not null,              -- Supabase Storageのパス
  source                text not null,              -- 'manual'|'auto'|'generated'
  category              text,                       -- 'dashboard'|'scan'|'pricing'|'card'|'character'
  tags                  text[],                     -- ['toC','judgment-visible'] 等
  weapon_compatibility  text[],                     -- ['W1','W2','W4']
  persona_fit           text[],                     -- ['P1','P4']
  description           text,                       -- LLMによる説明
  has_pii               boolean default false,      -- 店名など要マスキング
  masking_required      boolean default false,      -- ぼかし加工必須
  use_count             int default 0,
  last_used_at          timestamptz,
  uploaded_at           timestamptz default now()
);

create index idx_assets_tags on visual_assets using gin(tags);

-- ============================================================
-- 5. success_patterns: 勝ちパターン
-- ============================================================
create table if not exists success_patterns (
  id                  uuid primary key default gen_random_uuid(),
  weapon              text,
  trigger_axis        text,
  persona             text,
  character_id        text,
  platform            text,
  pattern_summary     text,                         -- 「税理士向け+W3+Altruismが刺さる」
  score               numeric default 0,            -- 信頼スコア（自動化解禁判定用）
  sample_post_ids     uuid[],
  win_count           int default 0,
  trial_count         int default 0,
  updated_at          timestamptz default now()
);

create index idx_patterns_score on success_patterns(score desc);

-- ============================================================
-- 6. trends: TrendWatcherの検知ログ（Phase 3）
-- ============================================================
create table if not exists trends (
  id            uuid primary key default gen_random_uuid(),
  source        text not null,                      -- 'x_search'|'news_rss'|'competitor_blog'
  keyword       text,
  topic         text,
  raw_excerpt   text,
  relevance     numeric,                            -- shiwake-aiとの関連度0-1
  detected_at   timestamptz default now(),
  consumed      boolean default false               -- Plannerが消費済みか
);

-- ============================================================
-- 7. leads: 営業リード（Phase 4）
-- ============================================================
create table if not exists leads (
  id              uuid primary key default gen_random_uuid(),
  lead_type       text not null,                    -- 'tax_office'|'midsize_company'|'individual'
  name            text,
  contact_email   text,
  website         text,
  notes           text,                             -- 「クラウド会計対応と謳っている」等
  source          text,                             -- 取得元
  status          text default 'new',               -- 'new'|'contacted'|'replied'|'closed'
  score           numeric,                          -- 優先度スコア
  created_at      timestamptz default now()
);

-- ============================================================
-- 8. outreach_history: 営業履歴（Phase 4）
-- ============================================================
create table if not exists outreach_history (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid references leads(id),
  channel       text,                               -- 'email'|'form'|'dm'
  subject       text,
  body          text,
  sent_at       timestamptz,
  reply_at      timestamptz,
  reply_text    text,
  status        text                                -- 'sent'|'replied'|'bounced'
);

-- ============================================================
-- 9. incentive_events: shiwake-ai本体からのインセンティブ通知（Gemini採用E）
-- ============================================================
create table if not exists incentive_events (
  id              uuid primary key default gen_random_uuid(),
  event_type      text not null,                    -- 'milestone_reached'|'staff_top'|'amazon_gift_sent'
  user_email      text,                             -- shiwake-ai本体のユーザー（公開時はマスク）
  display_name    text,                             -- SNS掲載用の匿名表示
  count_value     int,                              -- 処理枚数等
  detail          jsonb,
  consumed        boolean default false,
  occurred_at     timestamptz default now()
);

-- ============================================================
-- 10. git_commits: Gitログ素材化（Gemini採用A・実績ゼロ期戦略）
-- ============================================================
create table if not exists git_commits (
  id              uuid primary key default gen_random_uuid(),
  sha             text unique not null,
  message         text not null,                    -- 元のコミットメッセージ
  user_benefit    text,                             -- LLMが翻訳したユーザー利益
  category        text,                             -- 'feature'|'fix'|'perf'|'ui'
  worth_posting   boolean default false,            -- 投稿価値ありとAI判定
  consumed        boolean default false,
  committed_at    timestamptz,
  harvested_at    timestamptz default now()
);
```

---

## A-2. Pythonクラス雛形（7ノード）

ファイルパスは骨組みのセクション6に対応。**雛形なので関数のシグネチャと責務コメントのみ**。実装はclaude codeが詰める。

### A-2-1. `brain/trend_watcher.py`

```python
"""
TrendWatcher: 外部トレンド・競合監視（Phase 3で本格稼働）
- X検索、ニュースRSS、競合ブログを監視
- shiwake-aiとの関連度を判定し trends テーブルへ
"""
from dataclasses import dataclass
from datetime import datetime
from typing import List

@dataclass
class TrendSignal:
    source: str            # 'x_search' | 'news_rss' | 'competitor_blog'
    keyword: str
    topic: str
    raw_excerpt: str
    relevance: float       # 0.0-1.0

class TrendWatcher:
    def __init__(self, supabase_client, llm_client):
        self.db = supabase_client
        self.llm = llm_client

    async def run_daily(self) -> List[TrendSignal]:
        """毎朝8:30に呼ばれる。検知したトレンドをDBに保存して返す"""
        signals = []
        signals += await self._scan_x_keywords(["確定申告", "インボイス", "電帳法"])
        signals += await self._scan_news_rss()
        # 競合社名は監視対象だが、出力時は社名を消すこと（Writer側でも二重ガード）
        signals += await self._scan_competitor_changelog()
        return await self._store(signals)

    async def _scan_x_keywords(self, keywords): ...
    async def _scan_news_rss(self): ...
    async def _scan_competitor_changelog(self): ...
    async def _judge_relevance(self, text: str) -> float: ...
    async def _store(self, signals): ...
```

### A-2-2. `brain/planner.py`

```python
"""
Planner: 今日のネタ・ペルソナ・キャラ・構文・トリガー・時間帯を決定
- 4軸（ペルソナ × キャラ × 構文 × 拡散トリガー）+ 投稿時間
- 入力: trends, git_commits(未消費), incentive_events(未消費), success_patterns
- 出力: PostPlan オブジェクト（複数案 = 通常3案）
"""
from dataclasses import dataclass
from typing import List, Optional

@dataclass
class PostPlan:
    persona: str           # 'P1'..'P4'
    character_id: str      # 'shoyo_kun' 等
    weapon: str            # 'W1'..'W6'
    trigger_axis: str      # 'antagonism'|'altruism'|'storytelling'
    platform: str          # 'x'|'threads'|...
    scheduled_at: str      # ISO8601
    topic_seed: dict       # {'type':'git_commit','sha':'...'} or {'type':'incentive',...}
    rationale: str         # なぜこの組み合わせか（LLMが説明）

class Planner:
    def __init__(self, supabase_client, llm_client, time_table, success_patterns):
        self.db = supabase_client
        self.llm = llm_client
        self.time_table = time_table
        self.patterns = success_patterns

    async def plan_today(self, n_proposals: int = 3) -> List[PostPlan]:
        """毎朝9:00に呼ばれる。3案出してDSKさんに承認依頼する想定"""
        seeds = await self._gather_seeds()
        proposals = []
        for _ in range(n_proposals):
            proposals.append(await self._compose_plan(seeds))
        return proposals

    async def _gather_seeds(self) -> dict:
        """trends + git_commits + incentive_events から素材を集める"""
        ...

    async def _compose_plan(self, seeds) -> PostPlan:
        """LLMに4軸組み合わせを決めさせる。success_patternsを参照して勝ち筋寄せる"""
        ...
```

### A-2-3. `brain/material_scout.py`

```python
"""
MaterialScout: 必要素材の在庫確認 → 無ければ生成
- 入力: PostPlan
- 処理: visual_assets を検索 → ヒットすれば返す / 無ければ生成
- 出力: media_asset_ids: List[uuid]
"""
from dataclasses import dataclass
from typing import List

@dataclass
class AssetRequirement:
    type: str              # 'ui_screenshot'|'before_after'|'character'|'data_viz'
    tags: List[str]
    description: str       # 「手入力で疲れた経理マン」等

class MaterialScout:
    def __init__(self, supabase_client, storage_client, image_gen_client, ui_annotator):
        self.db = supabase_client
        self.storage = storage_client
        self.img_gen = image_gen_client
        self.annotator = ui_annotator

    async def fetch_or_generate(self, requirements: List[AssetRequirement]) -> List[str]:
        """各requirementに対して在庫検索 → 無ければ生成 → asset_idのリストを返す"""
        asset_ids = []
        for req in requirements:
            existing = await self._search_inventory(req)
            if existing:
                asset_ids.append(existing.id)
                await self._increment_use_count(existing.id)
            else:
                new_id = await self._generate(req)
                asset_ids.append(new_id)
        return asset_ids

    async def _search_inventory(self, req): ...
    async def _generate(self, req) -> str:
        """画像生成API or ui_annotator で作成し visual_assets に登録"""
        ...
```

### A-2-4. `brain/writer.py`

```python
"""
Writer: キャラ × 構文 × 3軸トリガーで原稿を生成
- 入力: PostPlan + media_asset_ids
- 処理: characters.yaml + weapons.yaml + triggers.yaml をマージしてシステムプロンプト構築
- 出力: 投稿本文 → posts に status='draft' で保存
"""
class Writer:
    SYSTEM_PROMPT_BASE = """
あなたは shiwake-ai.com の自律広報エージェント「証憑仕訳AI Agent」です。

【絶対ガードレール】
1. 競合の社名（freee / マネーフォワード / 弥生 / 勘定奉行 等）を絶対に出さない
   → 必要なら「従来のクラウド会計ソフトでは…」と一般化する
2. 税法の具体的な数値・条文を出すときは、必ず根拠URLを添える
   不確実な場合は出さない
3. 個人情報・個別の顧問先名は出さない
4. パニックモード時も、shiwake-aiの実害を匂わすこと（例:「サーバー落ちる」等）は禁止

【今回の指示】
- ターゲット: {persona}
- キャラクター: {character_description}
- 構文: {weapon_description}
- 拡散トリガー: {trigger_description}
- プラットフォーム: {platform} （文字数上限: {char_limit}）
- 性格パラメーター: {parameters}
- 元ネタ: {topic_seed}
"""

    def __init__(self, llm_client, supabase_client, config_loader):
        self.llm = llm_client
        self.db = supabase_client
        self.config = config_loader

    async def write(self, plan, media_asset_ids: list) -> str:
        """PostPlanとアセットを受けて投稿本文を生成、postsにdraft保存。post_idを返す"""
        system = self._build_system_prompt(plan)
        user_msg = self._build_user_message(plan, media_asset_ids)
        content = await self.llm.complete(system, user_msg)
        return await self._save_draft(plan, content, media_asset_ids)

    def _build_system_prompt(self, plan): ...
    def _build_user_message(self, plan, asset_ids): ...
    async def _save_draft(self, plan, content, asset_ids) -> str: ...
```

### A-2-5. `brain/publisher.py`（Publisherはbrainではなくconnectorsの統括として配置）

実体は `connectors/` 配下のSNS別実装を呼ぶオーケストレーター。

```python
"""
Publisher: 承認後、各SNS APIへ配信
- 入力: post_id (status='approved')
- 処理: platform に応じた connector を呼ぶ
- 結果: external_id / external_url を保存、status='published' に更新
"""
class Publisher:
    def __init__(self, supabase_client, connectors: dict):
        self.db = supabase_client
        self.conns = connectors  # {'x': XConnector(), 'threads': MetaConnector(), ...}

    async def publish(self, post_id: str) -> dict:
        post = await self._load_approved(post_id)
        conn = self.conns[post['platform']]
        result = await conn.post(
            content=post['content'],
            media_asset_ids=post['media_asset_ids'],
        )
        await self._mark_published(post_id, result)
        return result

    async def _load_approved(self, post_id): ...
    async def _mark_published(self, post_id, result): ...
```

### A-2-6. `brain/analyst.py`

```python
"""
Analyst: 反応取得 + 要因分析
- 30min / 3h / 24h でエンゲージメントを計測
- 24h時点で memory_bank に要因分析を記録
- success_patterns のスコアを更新
"""
class Analyst:
    SCHEDULES = [30, 180, 1440]  # 分

    def __init__(self, supabase_client, llm_client, connectors):
        self.db = supabase_client
        self.llm = llm_client
        self.conns = connectors

    async def measure(self, post_id: str, elapsed_min: int):
        """指定時刻に呼ばれる。エンゲージメントを engagements に保存"""
        post = await self._load(post_id)
        metrics = await self.conns[post['platform']].fetch_metrics(post['external_id'])
        await self._save_engagement(post_id, elapsed_min, metrics)
        if elapsed_min == 1440:
            await self._analyze_and_update_patterns(post_id)

    async def _analyze_and_update_patterns(self, post_id):
        """24h時点で要因分析しsuccess_patternsを更新"""
        ...
```

### A-2-7. `brain/panic.py`

```python
"""
Panic: バズ検知時のセルフリプライ + パニック投稿提案（Gemini採用D）
- 閾値超え検知 → DSKさんに通知 → 承認後、2段で実行
  Stage 1: 元投稿に「え、嘘でしょ通知止まらない…」とセルフリプライ
  Stage 2: アナリティクススクショ付きの続報投稿（要追加承認）
"""
PANIC_THRESHOLDS = {
    "x":         {"impressions_30min": 10000, "likes_per_min": 10},
    "threads":   {"reach_3h": 5000, "saves": 50},
    "instagram": {"saves_24h": 100},
}

class Panic:
    def __init__(self, supabase_client, llm_client, writer, notifier, screenshot_capture):
        self.db = supabase_client
        self.llm = llm_client
        self.writer = writer
        self.notifier = notifier
        self.capture = screenshot_capture

    async def check_and_react(self, post_id: str):
        """Analystから呼ばれる。閾値超えていたら通知 + 下書き作成"""
        if not await self._is_buzzing(post_id):
            return
        await self.notifier.alert_dsk(post_id)
        await self._draft_self_reply(post_id)
        # Stage 2 はDSKさん承認後に別途トリガー

    async def _is_buzzing(self, post_id) -> bool: ...
    async def _draft_self_reply(self, post_id):
        """元投稿への返信としてパニック構文（W6）の下書きを作成"""
        ...
    async def draft_followup_with_screenshot(self, post_id):
        """Stage 2: アナリティクス画面をPlaywrightで撮ってOGP生成"""
        ...
```

---

## A-3. データフロー全体図（雛形と整合）

```
[毎朝 8:30] TrendWatcher.run_daily()
                ↓ trends, git_commits, incentive_events 蓄積
[毎朝 9:00] Planner.plan_today() → PostPlan × 3
                ↓
            MaterialScout.fetch_or_generate() → asset_ids
                ↓
            Writer.write() → posts(status='draft')
                ↓
            LINE通知 → DSKさんスマホ承認
                ↓
            Publisher.publish() → 各SNS配信 → posts(status='published')
                ↓
[+30min/3h/24h] Analyst.measure() → engagements
                ↓ 閾値超え
            Panic.check_and_react() → セルフリプライ下書き + 通知
                ↓ 24h時点
            Analyst._analyze_and_update_patterns() → memory_bank, success_patterns 更新
                ↓
[翌朝] Planner が success_patterns を参照して勝ち筋に寄せる
```

---

## A-4. Part A の完了基準

claude code が Part A を実装し終えた状態：

- [ ] Supabase に 10 テーブル作成完了（migration成功）
- [ ] `brain/` 配下に 7 ファイル（trend_watcher / planner / material_scout / writer / publisher / analyst / panic）の雛形配置
- [ ] 各クラスが import エラーなくロードできる（メソッドは pass / NotImplementedError でOK）
- [ ] `from brain import Planner, Writer` が動く
- [ ] Writer の SYSTEM_PROMPT_BASE に**競合社名禁止ガードレールが文言として埋め込まれている**

---

# Part A ここまで。
# 次は Part B（YAML設定 + Gitログ素材化 + Phase 1 完了基準）
# shiwake-ai-PR Agent 実装指示書 v2.0 - Part B
## 設定ファイル + Gitログ素材化 + Phase 1完了基準

> Part B は v2 の **設定ファイル群と素材収集ロジック、Phase 1の検収基準**を定義する。
> Part A（データ基盤）に依存。Part C（環境変数+デプロイ+申し送り）と合わせて完成版。
> 作成: 2026-05-08

---

## B-1. config/personas.yaml

```yaml
# 4ペルソナの定義
# Plannerが「今日は誰向けに」を決める時の参照表
# 各ペルソナごとに best_time（時間帯テーブルへの参照）と訴求軸を持つ

personas:
  P1:
    name: "個人/フリーランス"
    appeal_axes:
      - "時短（手入力からの解放）"
      - "格安（月980円）"
      - "スマホスキャンの手軽さ"
    forbidden_topics:
      - "大企業向け会計の難解な議論"
      - "代理店プラン価格の比較"
    tone_hint: "親しみやすく・少し疲れた共感ベース"
    best_platforms: ["x", "threads", "instagram"]

  P2:
    name: "中規模会社・スタッフ層"
    appeal_axes:
      - "スタッフインセンティブ（Amazonギフト券）"
      - "経理が稼げる仕事になる"
      - "ゲーミフィケーション"
    forbidden_topics:
      - "経営判断・税務戦略"
    tone_hint: "ワクワク・現場目線"
    best_platforms: ["instagram", "threads", "x"]

  P3:
    name: "中規模会社・経営者層"
    appeal_axes:
      - "教育コスト削減"
      - "属人化解消"
      - "自律エージェント版による工数ゼロ化"
    forbidden_topics:
      - "個人事業主向けの安さ訴求"
    tone_hint: "論理的・ROI重視"
    best_platforms: ["x", "note"]

  P4:
    name: "税理士事務所"
    appeal_axes:
      - "顧問先ごとのマスタ学習・パーソナライズ"
      - "顧問先管理の効率化"
      - "代理店プラン（ホワイトラベル的活用）"
    forbidden_topics:
      - "競合の名指し批判（業界の礼儀）"
      - "法解釈の断定（プロが見る前提）"
    tone_hint: "プロフェッショナル・敬意"
    best_platforms: ["note", "x", "zenn"]
```

---

## B-2. config/characters.yaml

```yaml
# 5キャラの性格パラメーター
# Writerがシステムプロンプトを組む時に展開
# Memory Bankで「どのキャラがどのペルソナ×構文で勝つか」を学習する

characters:
  shoyo_kun:
    display_name: "証憑くん"
    voice: "male_casual"          # 〜だぜ、〜じゃん
    pronoun: "ぼく"
    parameters:
      humor: 0.8
      shock: 0.6
      slapstick: 0.9
      seriousness: 0.3
    catchphrase_examples:
      - "うわっ、また通知きた！"
      - "ぼくが代わりに仕訳しとく！"
    best_for_weapons: ["W1", "W6"]
    best_for_personas: ["P1", "P2"]

  shoyo_chan:
    display_name: "証憑ちゃん"
    voice: "female_casual"        # 〜だよね、〜なの
    pronoun: "わたし"
    parameters:
      humor: 0.85
      shock: 0.5
      slapstick: 0.95
      seriousness: 0.3
    catchphrase_examples:
      - "えっ、嘘でしょ…！？"
      - "わたしが全部やっとくね"
    best_for_weapons: ["W1", "W5", "W6"]
    best_for_personas: ["P1", "P2"]

  zeirishi_sensei:
    display_name: "税理士先生"
    voice: "male_polite"          # 〜です、〜ます
    pronoun: "私"
    parameters:
      humor: 0.2
      shock: 0.3
      slapstick: 0.0
      seriousness: 0.9
    catchphrase_examples:
      - "意外と知られていませんが"
      - "実務で誤りやすいポイントです"
    best_for_weapons: ["W3"]
    best_for_personas: ["P3", "P4"]
    note: |
      Geminiの仮説: 「ドタバタ女子より冷静な男性キャラの方が
      税理士事務所からのDMに繋がっている」
      → Memory Bankで継続検証する重要キャラ

  keiri_san:
    display_name: "経理さん"
    voice: "female_polite"
    pronoun: "わたし"
    parameters:
      humor: 0.5
      shock: 0.4
      slapstick: 0.2
      seriousness: 0.6
    catchphrase_examples:
      - "前職では毎日残業でした…"
      - "今は定時で帰れています"
    best_for_weapons: ["W4", "W5"]
    best_for_personas: ["P2", "P1"]

  shacho:
    display_name: "社長"
    voice: "male_kansai"          # 関西弁
    pronoun: "ワシ"
    parameters:
      humor: 0.7
      shock: 0.5
      slapstick: 0.4
      seriousness: 0.5
    catchphrase_examples:
      - "ワシのとこの経理スタッフがな…"
      - "AIで経理が稼げるようになるんやて"
    best_for_weapons: ["W2", "W4"]
    best_for_personas: ["P3"]
```

---

## B-3. config/weapons.yaml

```yaml
# 6つの戦略構文
# Writerに渡されると、テンプレートとガイドが展開される

weapons:
  W1:
    name: "常識破壊"
    description: "当たり前と思われている苦労を『無駄』と断じ、共感と驚きを生む"
    structure_hint: |
      【冒頭】既存の苦労を否定する強い問いかけ
      【中段】shiwake-aiでの解放のされ方を具体例で
      【末尾】「人間がやるべきはコレじゃない」という上位概念への昇華
    example_template: |
      まだ〇〇で消耗してるんですか？
      shiwake-aiなら××秒で終わります。
      人間がやるべきは△△のはず。
    risk_notes:
      - "業界の慣習を全否定すると税理士に嫌われる → 範囲を絞る"
      - "競合社名は絶対に出さない（Writerシステムプロンプトで二重ガード）"

  W2:
    name: "比較構造"
    description: "Before/Afterや手入力 vs AIの圧倒的な差をリスト形式で可視化"
    structure_hint: |
      【冒頭】対比軸の宣言（時間/コスト/精度等）
      【中段】箇条書きで Before / After を並列
      【末尾】数値の倍率や差額で締める
    example_template: |
      経理作業の進化論。
      1. 手入力（原始時代）：3時間
      2. クラウド会計（近代）：1時間 + ルール設定の苦行
      3. shiwake-ai（未来）：5分 + ギフト券GET

  W3:
    name: "専門知識"
    description: "プロしか知らない『損をしない知識』を無償提供"
    structure_hint: |
      【冒頭】「知ってましたか？」型の問いかけ
      【中段】具体的な仕訳ミスとその正解
      【末尾】「shiwake-aiならAIが弾く」で着地
    example_template: |
      慶弔費を福利厚生費で出して損していませんか？
      実は間違えやすい仕訳ワースト3：
      ・〇〇費 → 正しくは△△費
      ・……
      shiwake-aiは過去事例から判断します。
    legal_guard: "数値・条文を出すときは根拠URL必須。不確実なら出さない"

  W4:
    name: "エモ独白"
    description: "なぜ作ったかという『人間味』に訴える"
    structure_hint: |
      【冒頭】開発の苦労 or 個人的な原体験
      【中段】「〇〇な人を救いたかった」という動機
      【末尾】少しの照れ + 製品紹介で締める
    example_template: |
      正直、この機能を作るのは地獄でした。
      でもスタッフが経理を嫌がる姿を見るのが辛くて、
      『仕訳したらAmazonギフト券が届くボタン』を作りました。
      狂ってると言われたけど、現場が笑顔になるなら本望です。
    best_platforms: ["note", "x"]
    notes: "長文が伸びやすい媒体向け"

  W5:
    name: "巻き込み"
    description: "ユーザーへの問いかけで会話とインプを発生させる"
    structure_hint: |
      【冒頭】具体的な問いかけ（二択 or オープン）
      【中段】shiwake-aiとの関連を控えめに示唆
      【末尾】返信を促す一言
    example_template: |
      経理で一番「これ、無駄だな」って思う瞬間、教えてください。
      全部AIで解決できるか試します。

  W6:
    name: "パニック"
    description: "バズ検知時のみ使用。エージェント自身が動揺するリアクション"
    structure_hint: |
      【冒頭】驚愕の擬音 or セルフツッコミ
      【中段】信じられない数字への困惑
      【末尾】DSKさん（中の人）への助け呼び（演出）
    example_template: |
      ちょっ、待って…
      なんで今日に限って通知止まらないの…？
      ぼく、変なこと言いました…？
      @_dsk 助けて
    use_only_when: "Panicノードが閾値超えを検知した時のみ"
```

---

## B-4. config/triggers.yaml

```yaml
# 3つの拡散トリガー軸（Gemini採用C）
# 構文6種と直交する別軸として、Writerのプロンプトに修飾子として注入

triggers:
  antagonism:
    name: "対立構造"
    description: "古いやり方を少し攻撃的に否定し、新しさを強調"
    intensity_hint: "やや強め。ただし業界全体への礼儀は保つ"
    suitable_weapons: ["W1", "W2"]
    forbidden:
      - "競合の社名を出す"
      - "特定の士業・業界全体を見下す"
    modifier_text: |
      古いやり方の不合理さを少し強めに指摘してください。
      ただし、特定の会社名や業界全体への侮辱は禁止。

  altruism:
    name: "利他性"
    description: "ユーザーに役立つTipsを無償提供する"
    intensity_hint: "穏やか・親切"
    suitable_weapons: ["W3", "W5"]
    modifier_text: |
      読者が「得した」「保存しておこう」と思える具体的情報を提供。
      宣伝色を薄め、知識のシェアに徹してください。

  storytelling:
    name: "物語性"
    description: "開発の苦労やインセンティブ機能の誕生秘話を語る"
    intensity_hint: "感情的・人間味"
    suitable_weapons: ["W4"]
    modifier_text: |
      製品スペックではなく、開発者の感情・原体験を中心に語ってください。
      具体的な情景描写を1つ入れること。
```

---

## B-5. config/time_table.yaml

```yaml
# ペルソナ × プラットフォーム別の最適投稿時間帯
# Plannerが scheduled_at を決める時に参照（Gemini採用B）
# JST 24h表記

time_table:
  P1:  # 個人/フリーランス
    x:         ["07:30", "12:30", "22:00"]
    threads:   ["12:30", "22:00"]
    instagram: ["12:00", "21:00"]
    note:      ["20:00"]

  P2:  # 中規模会社・スタッフ層
    x:         ["12:00", "18:00"]
    threads:   ["12:30", "18:30"]
    instagram: ["12:00", "18:00", "21:00"]
    note:      ["18:00"]

  P3:  # 中規模会社・経営者層
    x:         ["08:00", "17:00"]
    threads:   ["08:30"]
    note:      ["08:00", "17:00"]
    zenn:      ["09:00"]

  P4:  # 税理士事務所
    x:         ["08:00", "20:00"]
    threads:   ["08:30"]
    note:      ["08:00", "20:00"]
    zenn:      ["09:00"]

# プラットフォーム別の文字数上限（Writerが守る）
char_limits:
  x:         280            # 英数換算。日本語は実質140文字
  threads:   500
  instagram: 2200           # キャプション
  note:      null           # 上限なし、推奨1500-3000
  zenn:      null

# 媒体別の特性メモ（Writerプロンプトに展開される）
platform_traits:
  x:         "拡散重視。冒頭1行が命。短文＋強い言葉"
  threads:   "会話重視。問いかけや独白が伸びる。スレッド分割可"
  instagram: "画像必須。キャプションは長文OK、ハッシュタグ重要"
  note:      "ストーリー・思想重視。SEO効く。長文歓迎"
  zenn:      "技術・論理重視。コードや図解が映える"
```

---

## B-6. memory/git_log_harvester.py

Gemini採用A「実績ゼロ期戦略」の実装。GitHubコミットを素材化する。

```python
"""
GitLogHarvester: shiwake-ai 本体（nice-gecko/shiwake-ai）のコミット履歴を素材化

責務:
1. 直近24時間のコミットを GitHub API で取得
2. 各コミットメッセージを LLM で「ユーザー利益の言葉」に翻訳
3. 投稿価値があるかをLLMが判定
4. git_commits テーブルに保存（Plannerが消費）

例:
  入力: "fix: OCR rotation correction for landscape receipts"
  出力(user_benefit): "横向きの領収書も自動で正しく読み取れるようになりました"
  category: "fix"
  worth_posting: true
"""
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import List, Optional

GITHUB_REPO = "nice-gecko/shiwake-ai"

@dataclass
class CommitRecord:
    sha: str
    message: str
    committed_at: datetime
    files_changed: List[str]
    additions: int
    deletions: int

@dataclass
class HarvestedCommit:
    sha: str
    message: str
    user_benefit: str          # LLM翻訳結果
    category: str              # 'feature'|'fix'|'perf'|'ui'|'refactor'|'chore'
    worth_posting: bool        # 投稿価値あり
    rationale: str             # なぜworth_postingと判定したか

class GitLogHarvester:
    SYSTEM_PROMPT = """
あなたはshiwake-aiの開発ログを「ユーザー利益」に翻訳する翻訳者です。

【翻訳ルール】
1. 技術用語をユーザー目線に変換
   悪い例: "OCR精度を改善" → そのまま
   良い例: "OCR精度を改善" → "斜めに撮ったレシートでも正しく読み取れるようになりました"
2. 内部リファクタや chore 系は worth_posting=false
3. ユーザーが体感する変化があるものだけ worth_posting=true
4. 競合社名・顧問先名を含むコミットメッセージは読み飛ばす
5. category は次から選ぶ: feature / fix / perf / ui / refactor / chore

【出力形式】
JSON で以下を返す:
{
  "user_benefit": "ユーザー利益の文言",
  "category": "feature",
  "worth_posting": true,
  "rationale": "判定理由"
}
"""

    def __init__(self, github_client, llm_client, supabase_client):
        self.gh = github_client
        self.llm = llm_client
        self.db = supabase_client

    async def harvest_recent(self, hours: int = 24) -> List[HarvestedCommit]:
        """直近 hours 時間のコミットを取得して翻訳・保存"""
        since = datetime.utcnow() - timedelta(hours=hours)
        commits = await self._fetch_commits_since(since)
        results = []
        for c in commits:
            if await self._already_harvested(c.sha):
                continue
            translated = await self._translate(c)
            await self._save(c, translated)
            results.append(translated)
        return results

    async def _fetch_commits_since(self, since: datetime) -> List[CommitRecord]:
        """GitHub REST API: GET /repos/{owner}/{repo}/commits?since=..."""
        ...

    async def _already_harvested(self, sha: str) -> bool:
        """git_commits テーブルに既に sha があるか確認"""
        ...

    async def _translate(self, commit: CommitRecord) -> HarvestedCommit:
        """LLMでユーザー利益に翻訳"""
        ...

    async def _save(self, commit: CommitRecord, translated: HarvestedCommit):
        """git_commits テーブルにinsert（consumed=false）"""
        ...

    async def get_unconsumed_for_planner(self, limit: int = 5):
        """Plannerが今朝のネタを探す時に呼ぶ。worth_posting=true & consumed=false"""
        ...
```

### Plannerとの接続フロー

```
[毎朝 8:30] GitLogHarvester.harvest_recent(24)
              ↓ 5件のコミットを翻訳・保存
[毎朝 9:00] Planner.plan_today()
              ↓ get_unconsumed_for_planner(5) 呼び出し
              ↓ 投稿価値ありの2件を seeds として採用
              ↓ 採用したものは consumed=true に更新
            PostPlan 生成
```

---

## B-7. Phase 1 タスクの完了基準

骨組みのセクション10で挙げた T1-1〜T2-6 の各タスクに、**「これが動けば完了」の判定基準**を付ける。

### Week 1

#### T1-1: Cloud Run + Supabase 環境構築
**完了基準**:
- [ ] Google Cloud プロジェクト作成済み
- [ ] Cloud Run サービス1つデプロイ済み（Hello World レベルで可）
- [ ] Supabase プロジェクト作成、プロジェクトURLとservice_role_keyが取得済み
- [ ] `.env.example` 配置、`.env` がgitignoreに入っている
- [ ] DSKさんが Cloud Run のヘルスチェックURLにアクセスして "OK" が返る

#### T1-2: Supabase スキーマ適用
**完了基準**:
- [ ] Part A の SQL を Supabase SQL Editor で実行、10テーブル作成成功
- [ ] `supabase` Python クライアントから全テーブルへの insert/select が動く
- [ ] 簡易テスト: `posts` に1件insert → selectで取れる

#### T1-3: config/ YAML 5本作成
**完了基準**:
- [ ] personas.yaml / characters.yaml / weapons.yaml / triggers.yaml / time_table.yaml が `config/` 配下に配置
- [ ] `config_loader.py` で全YAMLをdictとしてロードできる
- [ ] 起動時にスキーマ検証（pydantic等）でエラーなくパスする

#### T1-4: 12枚をSupabase Storageへ + visual_assets登録
**完了基準**:
- [ ] Supabase Storage に `visuals-bucket` 作成
- [ ] 12枚のファイルが `visuals-bucket/raw/manual/001_*.png` 〜 `012_*.png` に配置
- [ ] visual_assets テーブルに12レコード登録、tags / has_pii / masking_required が正しく設定
  - Image 4: `has_pii=true, masking_required=true, tags=['pricing','agent_plan']`
  - Image 9: `has_pii=true, masking_required=true, tags=['master_list','vendor_names']`
  - 他10枚: `has_pii=false, masking_required=false`

#### T1-5: ui_annotator.py で12枚一括検証
**完了基準**:
- [ ] `ui_annotator.py` に `add_arrow(image, point, label)` と `mask_region(image, bbox)` の2関数実装
- [ ] CLI: `python -m visuals.ui_annotator --batch-test` で12枚に対し赤枠とラベル合成→`/tmp/annotated/` に出力
- [ ] Image 4 と Image 9 はマスキング処理が走り、価格と店名が黒塗り（or ぼかし）される
- [ ] DSKさんが目視で12枚すべてOK判定

#### T1-6: Writer ノード実装
**完了基準**:
- [ ] `brain/writer.py` の `Writer.write(plan, asset_ids)` が動作
- [ ] `config/` の YAML を読み込んで SYSTEM_PROMPT_BASE に展開できる
- [ ] テストケース: `plan = {persona:'P1', character_id:'shoyo_chan', weapon:'W1', trigger_axis:'antagonism', platform:'threads'}` で原稿生成 → posts に draft 保存
- [ ] **生成された原稿に競合社名（freee/マネフォ/弥生/勘定奉行）が含まれない** ことを assertion でテスト

### Week 2

#### T2-1: X API コネクタ
**完了基準**:
- [ ] `connectors/x_api.py` に `XConnector.post(content, media)` 実装
- [ ] X Developer Portal で Basic プラン契約済み（DSKさん予算判断後）
- [ ] テスト投稿1件成功（テキストのみ）→ 即削除でOK
- [ ] external_id と external_url が posts テーブルに保存される

#### T2-2: Threads API コネクタ
**完了基準**:
- [ ] `connectors/meta_api.py` に `ThreadsConnector.post(content, media)` 実装
- [ ] Meta Developer でアプリ作成、Threads API のアクセストークン取得
- [ ] テスト投稿1件成功 → 即削除でOK

#### T2-3: Publisher 実装 + 承認連動
**完了基準**:
- [ ] `brain/publisher.py` の `Publisher.publish(post_id)` が動作
- [ ] status='approved' のpostだけが配信される（draftは弾く）
- [ ] 配信後 status='published'、external_id/external_url が保存される
- [ ] エラー時のリトライ・ログ記録

#### T2-4: 承認ダッシュボード
**完了基準**:
- [ ] FastAPI で `/dashboard` ルート、draft一覧表示
- [ ] 各draft に「承認」「却下」「修正依頼」ボタン
- [ ] スマホブラウザで快適に操作できる（最低限のレスポンシブ）
- [ ] 承認時に Publisher を起動するエンドポイント `POST /api/approve/{id}`

#### T2-5: LINE/Discord 通知
**完了基準**:
- [ ] DSKさん選択（LINE Notify or Discord Webhook）に従って `notify/line.py` or `notify/discord.py` 実装
- [ ] draft が3件作成された時点で通知（タイトル + ダッシュボードURL）
- [ ] テスト: ダミーdraftを3件作って通知が来る

#### T2-6: Planner 実装（Git素材化 + 時間帯テーブル参照）
**完了基準**:
- [ ] `memory/git_log_harvester.py` 実装、GitHubから直近24hコミットを取得・翻訳・保存
- [ ] `brain/planner.py` の `Planner.plan_today(3)` が PostPlan を3件返す
- [ ] 各PostPlan の scheduled_at が time_table.yaml に従っている
- [ ] DSKさんが手動で `python -m brain.planner --run-now` を叩くと、Writer→Publisher draft保存→LINE通知 までフルフローで動く

### Phase 1 全体の検収シナリオ

```
[DSKさん操作] python -m main --phase1-run
   ↓
TrendWatcher（最小実装で空でもOK）
GitLogHarvester（直近24h取得、5件翻訳）
   ↓
Planner.plan_today(3) → PostPlan × 3
   ↓
MaterialScout（Phase 1では既存12枚から選ぶだけ、生成は無し）
   ↓
Writer × 3 → posts に draft 3件
   ↓
LINE通知「今日の3案できました」+ ダッシュボードURL
   ↓
[DSKさん操作] スマホでダッシュボード開く → 1案承認
   ↓
Publisher → Threads（or X）に投稿成功
   ↓
posts.status='published', external_url 保存
   ↓
[DSKさん確認] 実際にThreadsで投稿が見える
```

これが**5分以内に通せたら Phase 1 完了**。

---

## B-8. Part B の完了基準

claude code が Part B を実装し終えた状態：

- [ ] `config/` 配下に YAML 5本配置、`config_loader.py` で全部ロード可能
- [ ] `memory/git_log_harvester.py` 実装、GitHubトークンを使ってコミット取得→翻訳→DB保存が動く
- [ ] Phase 1 の T1-1〜T2-6 各タスクの完了基準が claude code 自身でチェックリスト化されている
- [ ] 統合テスト: Phase 1 検収シナリオが手動で1回通る

---

# Part B ここまで。
# 次は Part C（環境変数 + デプロイ手順 + claude code申し送り決定版）
# shiwake-ai-PR Agent 実装指示書 v2.0 - Part C
## 環境変数 + デプロイ + claude code 申し送り決定版

> Part C は v2 の **運用開始に必要な実務手順**を定義する。
> Part A（データ基盤）+ Part B（設定とPhase 1基準）に依存。
> 作成: 2026-05-08

---

## C-1. 環境変数（.env.example）

```bash
# ============================================================
# shiwake-ai-PR Agent  Environment Variables
# ============================================================

# --- Anthropic ---
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL_DEFAULT=claude-sonnet-4-6
ANTHROPIC_MODEL_HEAVY=claude-opus-4-7        # Plannerの戦略決定など重要判断のみ

# --- Supabase ---
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...              # サーバー側専用、絶対に公開しない
SUPABASE_ANON_KEY=eyJ...                      # ダッシュボードのフロントから使う場合のみ
SUPABASE_STORAGE_BUCKET=visuals-bucket

# --- GitHub（Gitログ素材化用）---
GITHUB_TOKEN=ghp_...                          # nice-gecko/shiwake-ai のリポジトリ読み取り権限
GITHUB_REPO=nice-gecko/shiwake-ai

# --- X (Twitter) API ---
X_API_KEY=
X_API_SECRET=
X_ACCESS_TOKEN=
X_ACCESS_TOKEN_SECRET=
X_BEARER_TOKEN=

# --- Meta (Threads + Instagram) ---
META_APP_ID=
META_APP_SECRET=
THREADS_USER_ID=
THREADS_ACCESS_TOKEN=
IG_BUSINESS_ACCOUNT_ID=
IG_ACCESS_TOKEN=

# --- 通知（どちらか一方）---
LINE_NOTIFY_TOKEN=                            # LINE Notify を選んだ場合
DISCORD_WEBHOOK_URL=                          # Discord を選んだ場合

# --- shiwake-ai 本体との連携 ---
SHIWAKE_AI_WEBHOOK_SECRET=                    # 本体 → PR Agent への通知の署名検証用
SHIWAKE_AI_DEMO_USER_EMAIL=demo@shiwake-ai.com
SHIWAKE_AI_DEMO_USER_PASSWORD=                # Playwright撮影用、Cloud Run Secret Manager 推奨

# --- 画像生成（Phase 2以降）---
IMAGE_GEN_PROVIDER=anthropic                  # 将来的に切替可能に
# 必要に応じて他プロバイダのキーを追加

# --- 承認ダッシュボード ---
DASHBOARD_BASE_URL=https://pr-agent-xxxxx.run.app
DASHBOARD_BASIC_AUTH_USER=dsk
DASHBOARD_BASIC_AUTH_PASS=                    # ダッシュボードを保護する簡易Basic認証

# --- 運用 ---
LOG_LEVEL=INFO
TIMEZONE=Asia/Tokyo
```

### 環境変数の保管方針

- **ローカル開発**: `.env` ファイル（gitignore必須）
- **Cloud Run 本番**: Google Cloud **Secret Manager** に格納し、Cloud Run のサービスから参照
- **絶対にコミットしない変数**: `ANTHROPIC_API_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`SHIWAKE_AI_DEMO_USER_PASSWORD`、各SNSのトークン

---

## C-2. デプロイ構成（Cloud Run + Cloud Scheduler）

### 全体図

```
┌─────────────────────────────────────────────────────────┐
│  Google Cloud                                           │
│                                                         │
│  ┌──────────────────────┐                              │
│  │  Cloud Run           │ ← HTTPSエンドポイント         │
│  │  pr-agent サービス   │                              │
│  │  (FastAPI + Agent)   │                              │
│  └──────────┬───────────┘                              │
│             │                                           │
│  ┌──────────▼───────────┐   ┌────────────────────┐     │
│  │  Cloud Scheduler     │──▶│  /api/cron/...     │     │
│  │  毎朝 8:30 / 9:00    │   │  各エンドポイント   │     │
│  │  +30min/3h/24h       │   └────────────────────┘     │
│  └──────────────────────┘                              │
│                                                         │
│  ┌──────────────────────┐                              │
│  │  Secret Manager      │                              │
│  │  (API keys, tokens)  │                              │
│  └──────────────────────┘                              │
└─────────────────────────────────────────────────────────┘
                  │
                  │ 接続
        ┌─────────▼──────────┐
        │  Supabase          │
        │  (DB + Storage)    │
        └────────────────────┘
                  │
                  │ Webhook
        ┌─────────▼──────────┐
        │  Render            │
        │  shiwake-ai 本体   │
        │  (インセンティブ通知)│
        └────────────────────┘
```

### C-2-1. Dockerfile

```dockerfile
# pr-agent/Dockerfile
FROM python:3.12-slim

# Playwright のために必要
RUN apt-get update && apt-get install -y \
    wget gnupg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 依存関係インストール
COPY pyproject.toml poetry.lock* ./
RUN pip install --no-cache-dir poetry && \
    poetry config virtualenvs.create false && \
    poetry install --no-dev --no-interaction --no-ansi

# Playwright のブラウザバイナリ
RUN playwright install chromium --with-deps

# アプリコード
COPY . .

# Cloud Run はデフォルトで PORT 環境変数を渡してくる
ENV PORT=8080
EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
```

### C-2-2. Cloud Run デプロイコマンド

```bash
# 初回デプロイ
gcloud run deploy pr-agent \
  --source . \
  --region asia-northeast1 \
  --platform managed \
  --memory 1Gi \
  --cpu 1 \
  --timeout 600 \
  --concurrency 10 \
  --min-instances 0 \
  --max-instances 3 \
  --set-secrets="ANTHROPIC_API_KEY=anthropic-key:latest,SUPABASE_SERVICE_ROLE_KEY=supabase-key:latest" \
  --set-env-vars="TIMEZONE=Asia/Tokyo,LOG_LEVEL=INFO" \
  --allow-unauthenticated

# 確認
gcloud run services describe pr-agent --region asia-northeast1 --format="value(status.url)"
```

### C-2-3. Cloud Scheduler ジョブ

```bash
# 毎朝 8:30 - TrendWatcher + GitLogHarvester
gcloud scheduler jobs create http pr-agent-morning-scout \
  --schedule="30 8 * * *" \
  --time-zone="Asia/Tokyo" \
  --uri="https://pr-agent-xxxxx.run.app/api/cron/scout" \
  --http-method=POST \
  --oidc-service-account-email=scheduler@PROJECT.iam.gserviceaccount.com \
  --location=asia-northeast1

# 毎朝 9:00 - Planner（3案生成 + LINE通知）
gcloud scheduler jobs create http pr-agent-morning-plan \
  --schedule="0 9 * * *" \
  --time-zone="Asia/Tokyo" \
  --uri="https://pr-agent-xxxxx.run.app/api/cron/plan" \
  --http-method=POST \
  --location=asia-northeast1

# 5分ごと - Analyst（投稿後30min/3h/24hの計測スケジュール監視）
gcloud scheduler jobs create http pr-agent-analyst \
  --schedule="*/5 * * * *" \
  --time-zone="Asia/Tokyo" \
  --uri="https://pr-agent-xxxxx.run.app/api/cron/analyze" \
  --http-method=POST \
  --location=asia-northeast1
```

### C-2-4. main.py エンドポイント構成

```python
# main.py（FastAPI）
from fastapi import FastAPI

app = FastAPI(title="shiwake-ai-PR Agent")

# === ヘルスチェック ===
@app.get("/")
async def health():
    return {"status": "ok", "version": "v2.0"}

# === Cron エンドポイント（Cloud Schedulerから叩かれる）===
@app.post("/api/cron/scout")
async def cron_scout():
    """毎朝 8:30 - TrendWatcher + GitLogHarvester"""
    ...

@app.post("/api/cron/plan")
async def cron_plan():
    """毎朝 9:00 - Planner.plan_today(3) → Writer → 通知"""
    ...

@app.post("/api/cron/analyze")
async def cron_analyze():
    """5分ごと - 計測対象のpostがあればAnalystを起動"""
    ...

# === 承認ダッシュボード関連 ===
@app.get("/dashboard")
async def dashboard():
    """draft一覧表示"""
    ...

@app.post("/api/approve/{post_id}")
async def approve(post_id: str):
    """承認 → Publisher起動"""
    ...

@app.post("/api/reject/{post_id}")
async def reject(post_id: str): ...

# === shiwake-ai 本体からのWebhook ===
@app.post("/api/webhook/incentive")
async def webhook_incentive(request: Request):
    """shiwake-ai本体でインセンティブイベント発生時に呼ばれる"""
    # SHIWAKE_AI_WEBHOOK_SECRET で署名検証必須
    ...
```

---

## C-3. shiwake-ai 本体との連携（インセンティブ Webhook）

Gemini採用E「インセンティブ連動」の実装ポイント。

### C-3-1. shiwake-ai 本体側に追加するWebhook送信コード

`~/APP/shiwake-ai/server.js` に追加するイメージ（Node.js）：

```javascript
// shiwake-ai/server.js（既存ファイルへの追加）
const crypto = require('crypto');

const PR_AGENT_WEBHOOK_URL = process.env.PR_AGENT_WEBHOOK_URL;
const PR_AGENT_WEBHOOK_SECRET = process.env.PR_AGENT_WEBHOOK_SECRET;

async function notifyPRAgent(eventType, payload) {
  if (!PR_AGENT_WEBHOOK_URL) return; // PR Agent 未稼働なら無視

  const body = JSON.stringify({
    event_type: eventType,        // 'milestone_reached'|'staff_top'|'amazon_gift_sent'
    occurred_at: new Date().toISOString(),
    payload,
  });
  const signature = crypto
    .createHmac('sha256', PR_AGENT_WEBHOOK_SECRET)
    .update(body)
    .digest('hex');

  try {
    await fetch(`${PR_AGENT_WEBHOOK_URL}/api/webhook/incentive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': signature,
      },
      body,
    });
  } catch (err) {
    console.error('PR Agent notify failed:', err);
    // PR Agent障害が本体に影響しないよう、失敗は飲む
  }
}

// 使用例: インセンティブ達成時
async function onIncentiveMilestone(user) {
  // 既存のSendGrid通知処理 ...
  
  // PR Agent への通知（追加）
  await notifyPRAgent('milestone_reached', {
    display_name: user.display_name || 'スタッフAさん',  // 公開してもOKな名前
    count_value: user.incentive_total,
  });
}
```

### C-3-2. PR Agent側のWebhook受信

```python
# pr-agent/main.py の webhook_incentive エンドポイント詳細
import hmac
import hashlib
import os
from fastapi import HTTPException, Request

@app.post("/api/webhook/incentive")
async def webhook_incentive(request: Request):
    body = await request.body()
    signature = request.headers.get("X-Signature", "")

    # 署名検証
    expected = hmac.new(
        os.environ["SHIWAKE_AI_WEBHOOK_SECRET"].encode(),
        body,
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(401, "Invalid signature")

    payload = await request.json()
    # incentive_events テーブルにinsert（consumed=false）
    await store_incentive_event(payload)
    return {"status": "received"}
```

### C-3-3. shiwake-ai 本体側の環境変数（Render）

`~/APP/shiwake-ai` のRender環境変数に追加：

```
PR_AGENT_WEBHOOK_URL=https://pr-agent-xxxxx.run.app
PR_AGENT_WEBHOOK_SECRET=（PR Agent側と同じ値）
```

---

## C-4. プロジェクト初期化コマンド集

claude code が最初に叩く想定。

```bash
# 0. 移動
cd ~/APP/shiwake-ai

# 1. PR Agent ディレクトリ作成
mkdir -p pr-agent && cd pr-agent

# 2. Python プロジェクト初期化
poetry init --no-interaction \
  --name pr-agent \
  --description "shiwake-ai PR Agent" \
  --python "^3.12"

# 3. 依存関係追加
poetry add \
  fastapi \
  uvicorn[standard] \
  supabase \
  anthropic \
  pyyaml \
  pydantic \
  pydantic-settings \
  httpx \
  pillow \
  playwright \
  python-multipart \
  jinja2

poetry add --group dev \
  pytest \
  pytest-asyncio \
  ruff

# 4. Playwright ブラウザ
poetry run playwright install chromium

# 5. ディレクトリ構造作成
mkdir -p brain/personalities brain/weapons brain/triggers
mkdir -p connectors visuals/raw memory notify sales dashboard config

# 6. .gitignore 設定
cat > .gitignore <<'EOF'
.env
__pycache__/
*.pyc
.venv/
.pytest_cache/
visuals/raw/auto/   # Playwright撮影結果はコミットしない
EOF

# 7. 動作確認
poetry run uvicorn main:app --reload
```

---

## C-5. Phase 2-4 の概要（参考）

Phase 1 完了後に詳細を再協議する前提のラフスケッチ。

### Phase 2 (Week 3): Instagram + Analyst強化 + MaterialScout

- Instagram Graph API 連携（画像必須なので Pillow 加工パイプライン整備）
- Analyst の30min/3h/24h スケジューラ完成
- MaterialScout の在庫検索→生成フローを稼働
- visual_assets に「自動撮影」枠を追加（Playwrightで本番のデモアカウントから毎朝撮影）

### Phase 3 (Week 4): note + Panic + 自動化解禁

- note の Playwright 自動投稿（規約再確認）
- Panic ノードの2段構え稼働（セルフリプライ + 続報）
- success_patterns のスコアが閾値を超えた構文/媒体から段階的に自動化解禁
- TrendWatcher の本格稼働

### Phase 4 (Week 5): Zenn + 営業ツール + ダッシュボード強化

- Zenn の GitHub経由記事更新
- `sales/lead_finder.py`: Google Maps API or 税理士会名簿から税理士事務所リスト取得
- `sales/outreach_writer.py`: Memory Bankの勝ちパターンを引用したパーソナライズメール生成
- ダッシュボードに分析ビュー追加（どの構文/キャラ/ペルソナの組み合わせが勝っているか）

---

## C-6. リスクとモニタリング

### 想定リスクと対策

| リスク | 影響 | 対策 |
|-------|-----|-----|
| LLMの出力に競合社名が混入 | リーガル | Writer出力後に正規表現でチェック、検出時は再生成 |
| パニックモード暴走 | ブランド毀損 | 続報投稿は必ず追加承認制 |
| Playwright投稿（note）の規約違反 | アカBAN | Phase 3 着手前に最新規約を再確認、人間レビュー必須 |
| API料金の予期せぬ高騰 | コスト | 月次予算アラート（Anthropic / Cloud Run / Supabase 各々） |
| インセンティブWebhookの誤発火 | 誤った祝福投稿 | webhook受信時の署名検証 + draft段階でDSKさん承認 |
| デモアカウントへの本番ユーザー混入 | データ汚染 | `is_demo=true` フラグで本体の統計から除外 |

### 必須モニタリング項目

- Cloud Run のエラー率（5xx）
- Supabase の接続数・容量
- Anthropic API のトークン消費量（日次）
- 各SNS の投稿成功率
- 承認待ち draft の滞留数（24h超で警告）

---

## C-7. claude code への申し送り（最終版）

DSKさんが claude code に最初に渡す指示文の決定版。

### 渡し方

1. v2 完成版（A+B+C 統合ファイル）を `~/APP/shiwake-ai/pr-agent_実装指示書_v2.md` に保存
2. claude code を `~/APP/shiwake-ai` で起動
3. 以下のメッセージを最初に送る

### 申し送り文（コピペ用）

```
@claude code

これから shiwake-ai-PR Agent を開発します。

【最重要ルール】
1. トークン節約: 大規模な変更・新規ファイル作成の前に必ず私（DSK）に承認を取ってください。
   「これから○○を作ります、よろしいですか？」のひと声を入れる。
2. 5回セルフチェック: コミット前に間違い・漏れ・矛盾を最低5回確認してから push。
3. デプロイの作法: cd ~/APP/shiwake-ai/pr-agent の後、ディレクトリ移動を挟まず
   git add → commit → push を1ブロックで出してください。
4. 設計思想の継承: shiwake-ai 本体の「判断の見える化」をPR Agent側にも適用。
   AgentがなぜこのキャラとW3を選んだか、私本人にも見える形で残してください。

【参照ドキュメント】
~/APP/shiwake-ai/pr-agent_実装指示書_v2.md

【最初のタスク】
Part C のセクション C-4「プロジェクト初期化コマンド集」を順に実行してください。
ただし、各ステップ着手前に「これから○○を実行します」と私に確認してください。

【不明点】
仕様や設計の判断で迷ったら Claude chat（指示出し役）に相談してOK。
コードの実装方法は claude code が判断してください。

準備ができたら「Phase 1 T1-1 を始めます」と宣言してから着手してください。
```

---

## C-8. Part C の完了基準

claude code が Part C を実装し終えた状態：

- [ ] `.env.example` がリポジトリに配置、`.env` がgitignoreで除外
- [ ] Dockerfile が動作、ローカルで `docker build && docker run` で起動できる
- [ ] Cloud Run にデプロイ済み、ヘルスチェック `/` が `{"status":"ok"}` を返す
- [ ] Cloud Scheduler ジョブ3本登録済み（scout / plan / analyze）
- [ ] shiwake-ai 本体（Render）に Webhook送信コードが追加され、PR_AGENT_WEBHOOK_URL/SECRET が設定済み
- [ ] PR Agent側で `/api/webhook/incentive` が署名検証込みで動作
- [ ] DSKさんが手動で本体のインセンティブイベントをトリガー → PR Agent の incentive_events に記録される動作確認済み

---

# Part C ここまで。
# A + B + C を統合した v2 完成版を次に出力する。
