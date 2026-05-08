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
