-- v2.7.0: 突合機能 スキーマ追加
-- 実行場所: Supabase SQL Editor (shiwake-ai / tmddairlgpyinqfekkfg)
-- 実行前確認: SELECT current_database(); → shiwake-ai であること
-- 実行はユーザーが手動で行うこと（Claude Code は実行しない）
-- 作成日: 2026-05-15

-- =============================================
-- 1. reconciliation_sources（アップロードされた照合用ファイル）
-- =============================================

CREATE TABLE IF NOT EXISTS reconciliation_sources (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID         NOT NULL REFERENCES workspaces(id),
  source_type      TEXT         NOT NULL,          -- 'bank' / 'card' / 'invoice'
  institution_name TEXT,                           -- 例: '三井住友銀行'
  account_info     TEXT,                           -- 例: '普通 1234567'
  period_year      INTEGER,
  period_month     INTEGER,
  file_storage_path TEXT,
  total_entries    INTEGER      DEFAULT 0,
  created_at       TIMESTAMPTZ  DEFAULT now(),
  updated_at       TIMESTAMPTZ  DEFAULT now()
);

ALTER TABLE reconciliation_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reconciliation_sources_workspace_access" ON reconciliation_sources
  FOR ALL USING (
    workspace_id IN (
      SELECT id FROM workspaces WHERE owner_uid = auth.uid()
    )
  );


-- =============================================
-- 2. reconciliation_entries（パースされた個別明細行）
-- =============================================

CREATE TABLE IF NOT EXISTS reconciliation_entries (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id           UUID         NOT NULL REFERENCES reconciliation_sources(id) ON DELETE CASCADE,
  workspace_id        UUID         NOT NULL REFERENCES workspaces(id),
  entry_date          DATE         NOT NULL,
  description         TEXT,
  amount              NUMERIC(12,0) NOT NULL,       -- 日本円、小数なし
  direction           TEXT         NOT NULL,        -- 'debit' / 'credit'
  match_status        TEXT         NOT NULL DEFAULT 'unmatched', -- 'matched' / 'candidate' / 'unmatched' / 'resolved'
  matched_record_id   UUID         REFERENCES shiwake_records(id),
  matched_source_id   UUID         REFERENCES reconciliation_sources(id), -- カード照合用
  resolution_type     TEXT,                         -- 'fee' / 'discount' / 'offset' / 'other'
  resolution_note     TEXT,
  amount_difference   NUMERIC(12,0) DEFAULT 0,
  created_at          TIMESTAMPTZ  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_entries_workspace_date
  ON reconciliation_entries (workspace_id, entry_date);

CREATE INDEX IF NOT EXISTS idx_reconciliation_entries_source
  ON reconciliation_entries (source_id);

CREATE INDEX IF NOT EXISTS idx_reconciliation_entries_unmatched
  ON reconciliation_entries (match_status)
  WHERE match_status != 'matched';

ALTER TABLE reconciliation_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reconciliation_entries_workspace_access" ON reconciliation_entries
  FOR ALL USING (
    workspace_id IN (
      SELECT id FROM workspaces WHERE owner_uid = auth.uid()
    )
  );


-- =============================================
-- 3. partner_aliases（取引先の銀行カタカナ名辞書）
-- =============================================

CREATE TABLE IF NOT EXISTS partner_aliases (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID         NOT NULL REFERENCES workspaces(id),
  canonical_name   TEXT         NOT NULL,  -- 正式名称
  alias            TEXT         NOT NULL,  -- 銀行表記のカタカナ等
  source           TEXT         DEFAULT 'manual',  -- 'bank' / 'card' / 'manual'
  created_at       TIMESTAMPTZ  DEFAULT now(),
  UNIQUE (workspace_id, alias)
);

CREATE INDEX IF NOT EXISTS idx_partner_aliases_workspace_alias
  ON partner_aliases (workspace_id, alias);

ALTER TABLE partner_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "partner_aliases_workspace_access" ON partner_aliases
  FOR ALL USING (
    workspace_id IN (
      SELECT id FROM workspaces WHERE owner_uid = auth.uid()
    )
  );
