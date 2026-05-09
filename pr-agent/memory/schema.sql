-- ============================================================
-- shiwake-ai-PR Agent  Memory Bank Schema v1.1
-- patch_001 適用: posts に awaiting_manual_post + 手動投稿カラム追加
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
  platform        text not null,
  -- 'x'|'threads'|'instagram'|'note'|'zenn'
  persona         text not null,
  -- 'P1'|'P2'|'P3'|'P4'
  character_id    text not null,
  -- 'shoyo_kun'|'shoyo_chan'|'zeirishi_sensei'|'keiri_san'|'shacho'
  weapon          text not null,
  -- 'W1'..'W6'
  trigger_axis    text,
  -- 'antagonism'|'altruism'|'storytelling'
  parameters      jsonb,
  -- 性格パラメーター実値 {humor, shock, slapstick, seriousness, voice}
  content         text not null,
  media_asset_ids uuid[],
  -- visual_assets 参照
  status          text not null default 'draft',
  -- 'draft'|'approved'|'awaiting_manual_post'|'published'|'rejected'
  -- 'awaiting_manual_post': X専用。承認済みだがDSKさん手動投稿待ち
  scheduled_at    timestamptz,
  published_at    timestamptz,
  external_id     text,
  -- SNS側の投稿ID
  external_url    text,
  -- 公開URL
  manual_posted_at  timestamptz,
  -- X手動投稿完了日時（patch_001）
  manual_posted_url text,
  -- X手動投稿後にDSKさんが貼り付けるURL（patch_001）
  retry_of        uuid references posts(id),
  -- 過去投稿への参照（Re-trial Strategy）
  parent_post_id  uuid references posts(id),
  -- セルフリプライ時の親
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists idx_posts_status   on posts(status);
create index if not exists idx_posts_platform on posts(platform, published_at desc);
create index if not exists idx_posts_persona  on posts(persona);

-- updated_at 自動更新トリガー
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace trigger trg_posts_updated_at
  before update on posts
  for each row execute function set_updated_at();

-- ============================================================
-- 2. engagements: 反応データ（30min/3h/24h）
-- ============================================================
create table if not exists engagements (
  id            uuid primary key default gen_random_uuid(),
  post_id       uuid not null references posts(id) on delete cascade,
  measured_at   timestamptz not null default now(),
  elapsed_min   int not null,
  -- 30 / 180 / 1440
  impressions   int default 0,
  likes         int default 0,
  comments      int default 0,
  shares        int default 0,
  saves         int default 0,
  -- Insta/Threadsで重要
  clicks        int default 0,
  raw           jsonb,
  created_at    timestamptz default now()
);

create index if not exists idx_engagements_post on engagements(post_id, elapsed_min);

-- ============================================================
-- 3. memory_bank: 要因分析・next_action
-- ============================================================
create table if not exists memory_bank (
  id              uuid primary key default gen_random_uuid(),
  post_id         uuid references posts(id),
  content_theme   text,
  parameters      jsonb,
  results_summary jsonb,
  -- {imp, save, neg_feedback}
  ai_analysis     text,
  -- LLMが書いた要因分析
  next_action     text,
  retry_lineage   uuid[],
  -- 系譜（A→B→Cと改善した履歴）
  created_at      timestamptz default now()
);

-- ============================================================
-- 4. visual_assets: 画像カタログ
-- ============================================================
create table if not exists visual_assets (
  id                    uuid primary key default gen_random_uuid(),
  storage_path          text not null,
  -- Supabase Storageのパス
  source                text not null,
  -- 'manual'|'auto'|'generated'
  category              text,
  -- 'dashboard'|'scan'|'pricing'|'card'|'character'
  tags                  text[],
  -- ['toC','judgment-visible'] 等
  weapon_compatibility  text[],
  -- ['W1','W2','W4']
  persona_fit           text[],
  -- ['P1','P4']
  description           text,
  has_pii               boolean default false,
  -- 店名など要マスキング
  masking_required      boolean default false,
  use_count             int default 0,
  last_used_at          timestamptz,
  uploaded_at           timestamptz default now()
);

create index if not exists idx_assets_tags on visual_assets using gin(tags);

-- ============================================================
-- 5. success_patterns: 勝ちパターン（P3-5: 旧スキーマから刷新）
-- ============================================================
-- ※ Supabase 適用時: DROP TABLE IF EXISTS success_patterns; を先に実行
create table if not exists success_patterns (
  id                   uuid primary key default gen_random_uuid(),
  persona_id           text not null,
  -- P1〜P4
  character_id         text not null,
  weapon_id            text not null,
  -- W1〜W6
  trigger_id           text not null,
  -- antagonism / altruism / storytelling
  platform             text not null,
  sample_count         int not null default 0,
  avg_engagement_rate  double precision,
  avg_likes            double precision,
  win_count            int not null default 0,
  loss_count           int not null default 0,
  win_rate             double precision,
  -- = win_count / sample_count
  last_updated_at      timestamptz default now(),
  unique (persona_id, character_id, weapon_id, trigger_id, platform)
);

create index if not exists idx_sp_lookup  on success_patterns(persona_id, character_id, weapon_id, trigger_id, platform);
create index if not exists idx_sp_winrate on success_patterns(win_rate desc nulls last);

-- ============================================================
-- 6. trends: TrendWatcherの検知ログ（P3-2）
-- ============================================================
-- ※ Supabase 適用時: 旧 trends テーブルが存在する場合は先に DROP TABLE trends; を実行すること
create table if not exists trends (
  id                uuid primary key default gen_random_uuid(),
  source_id         text not null,
  -- 'nta_news'|'mof_whatsnew'|'chusho_whatsnew'|'note_keiri'|'note_zeirishi'
  title             text not null,
  url               text not null,
  url_hash          text not null,
  -- sha256(url)[:16]、重複除外用
  category          text not null,
  -- 'tax_law'|'smb_policy'|'trend'
  weight            double precision not null default 1.0,
  score             double precision not null default 0.0,
  matched_keywords  text[] default '{}',
  fetched_at        timestamptz not null default now(),
  used_in_post_id   uuid,
  -- 投稿素材に使われたなら posts.id を記録
  used_at           timestamptz
);

create unique index if not exists ux_trends_url_hash on trends(url_hash);
create index        if not exists idx_trends_fetched  on trends(fetched_at desc);
create index        if not exists idx_trends_score    on trends(score desc);

-- ============================================================
-- 7. leads: 営業リード（P4-2 刷新）
-- ============================================================
-- ※ Supabase 適用時: DROP TABLE IF EXISTS outreach_history; DROP TABLE IF EXISTS leads; を先に実行
create table if not exists leads (
  id                   uuid primary key default gen_random_uuid(),
  company_name         text not null,
  contact_person       text,
  email                text,
  phone                text,
  website              text,
  address              text,
  size_estimate        text,
  -- 'small'|'medium'|'large'
  specialty            text[],
  -- ['法人税務','相続'] など
  digital_savvy_score  integer,
  -- 1-5
  priority_score       integer,
  -- 1-5
  target_persona       text default 'P4',
  found_at             timestamptz default now(),
  found_by             text default 'cowork',
  -- 'cowork'|'manual'|'referral'
  notes                text,
  status               text default 'new'
  -- 'new'|'contacted'|'replied'|'converted'|'rejected'|'archived'
);

create index if not exists idx_leads_priority on leads(priority_score desc);
create index if not exists idx_leads_status   on leads(status);

-- ============================================================
-- 8. outreach_history: 営業履歴（P4-2 刷新）
-- ============================================================
create table if not exists outreach_history (
  id                     uuid primary key default gen_random_uuid(),
  lead_id                uuid not null references leads(id) on delete cascade,
  sent_at                timestamptz default now(),
  channel                text not null,
  -- 'email'|'phone'|'in_person'|'webform'
  subject                text,
  body                   text,
  template_used          text,
  sent_by                text default 'cowork',
  -- 'cowork'|'dsk'|'auto'
  response_received      boolean default false,
  response_received_at   timestamptz,
  response_summary       text,
  response_sentiment     text,
  -- 'positive'|'neutral'|'negative'
  led_to_meeting         boolean default false,
  led_to_signup          boolean default false,
  notes                  text
);

create index if not exists idx_outreach_lead on outreach_history(lead_id);
create index if not exists idx_outreach_sent on outreach_history(sent_at desc);

-- ============================================================
-- 9. incentive_events: shiwake-ai本体からのインセンティブ通知
-- ============================================================
create table if not exists incentive_events (
  id              uuid primary key default gen_random_uuid(),
  event_type      text not null,
  -- 'milestone_reached'|'staff_top'|'amazon_gift_sent'
  user_email      text,
  display_name    text,
  -- SNS掲載用の匿名表示
  count_value     int,
  detail          jsonb,
  consumed        boolean default false,
  occurred_at     timestamptz default now()
);

-- ============================================================
-- 10. git_commits: Gitログ素材化（実績ゼロ期戦略）
-- ============================================================

create table if not exists git_commits (
  id              uuid primary key default gen_random_uuid(),
  sha             text unique not null,
  message         text not null,
  user_benefit    text,
  -- LLMが翻訳したユーザー利益
  category        text,
  -- 'feature'|'fix'|'perf'|'ui'
  worth_posting   boolean default false,
  -- 投稿価値ありとAI判定
  consumed        boolean default false,
  committed_at    timestamptz,
  harvested_at    timestamptz default now()
);

-- ============================================================
-- 11. panic_log: Panicノード発火履歴（P3-1）
-- ============================================================
create table if not exists panic_log (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references posts(id) on delete cascade,
  platform     text not null,
  checkpoint   text not null,
  -- '30min' | '180min'
  triggered_at timestamptz not null default now(),
  draft_id     uuid,
  -- セルフリプライ案の post_id（あれば）
  approved     boolean default false,
  posted_at    timestamptz,
  posted_url   text,
  reason       text
);

create index if not exists idx_panic_log_post      on panic_log(post_id);
create index if not exists idx_panic_log_triggered on panic_log(triggered_at desc);

-- ============================================================
-- 12. automation_settings: 自動化解禁トグル（P3-3）
-- ============================================================
create table if not exists automation_settings (
  id           uuid primary key default gen_random_uuid(),
  platform     text not null unique,
  -- 'threads'|'instagram'|'note'
  auto_publish boolean not null default false,
  -- 承認スキップ可否（Panic は常に false）
  auto_panic   boolean not null default false,
  updated_at   timestamptz not null default now(),
  updated_by   text
  -- 'dsk' / 'system_recommendation_accepted' 等
);

-- 初期データ(3プラットフォーム、すべてOFF)
insert into automation_settings (platform, auto_publish, auto_panic) values
  ('threads',   false, false),
  ('instagram', false, false),
  ('note',      false, false)
on conflict (platform) do nothing;
