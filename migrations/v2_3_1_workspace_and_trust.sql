-- v2.3.1: ワークスペース機能 + 信頼度メトリクス基盤
-- 実行場所: Supabase ダッシュボード > SQL Editor
-- 実行順序: 上から順に全て実行

-- =============================================
-- 1. workspaces テーブル作成
-- =============================================
CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_uid TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT,
  is_default BOOLEAN DEFAULT false,
  is_archived BOOLEAN DEFAULT false,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  client_email_domains TEXT[],
  client_email_addresses TEXT[],
  subject_keywords TEXT[],
  color TEXT,
  icon TEXT,
  CONSTRAINT unique_owner_default UNIQUE (owner_uid, is_default)
);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(owner_uid);
CREATE INDEX IF NOT EXISTS idx_workspaces_owner_active ON workspaces(owner_uid, is_archived);

-- =============================================
-- 2. users テーブルへの current_workspace_id 列追加
-- =============================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_workspace_id UUID;

-- =============================================
-- 3. shiwake_records テーブル作成
-- =============================================
CREATE TABLE IF NOT EXISTS shiwake_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uid TEXT NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  shiwake_date DATE,
  partner_name TEXT,
  debit_account TEXT,
  credit_account TEXT,
  tax_category TEXT,
  amount NUMERIC,
  memo TEXT,
  invoice_number TEXT,
  ai_proposed_debit_account TEXT,
  ai_proposed_credit_account TEXT,
  ai_proposed_tax_category TEXT,
  ai_proposed_memo TEXT,
  was_modified BOOLEAN NOT NULL DEFAULT false,
  modified_fields TEXT[] DEFAULT NULL,
  matched_master_key TEXT DEFAULT NULL,
  master_hit_method TEXT DEFAULT NULL,
  source_session_id TEXT,
  source_file_name TEXT,
  approved_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shiwake_records_workspace_approved
  ON shiwake_records(workspace_id, approved_at);
CREATE INDEX IF NOT EXISTS idx_shiwake_records_uid
  ON shiwake_records(uid);

-- =============================================
-- 4. workspace_trust_metrics テーブル作成
-- =============================================
CREATE TABLE IF NOT EXISTS workspace_trust_metrics (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  total_approved INTEGER NOT NULL DEFAULT 0,
  total_modified INTEGER NOT NULL DEFAULT 0,
  trust_score_all NUMERIC,
  field_accuracy_all JSONB,
  modification_trend_all JSONB,
  recent_approved INTEGER NOT NULL DEFAULT 0,
  recent_modified INTEGER NOT NULL DEFAULT 0,
  trust_score_recent NUMERIC,
  field_accuracy_recent JSONB,
  modification_trend_recent JSONB,
  master_count INTEGER NOT NULL DEFAULT 0,
  master_hit_rate NUMERIC,
  maturity_level TEXT NOT NULL DEFAULT 'rookie',
  last_calculated_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================
-- 5. RPC関数: calc_trust_metrics
-- =============================================
CREATE OR REPLACE FUNCTION calc_trust_metrics(
  p_workspace_id UUID,
  p_period TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_since TIMESTAMPTZ;
  v_total INTEGER;
  v_modified INTEGER;
  v_field_acc JSONB;
  v_trend JSONB;
BEGIN
  v_since := CASE WHEN p_period = 'recent'
                   THEN NOW() - INTERVAL '30 days'
                   ELSE '1900-01-01'::TIMESTAMPTZ
              END;

  SELECT
    COUNT(*) FILTER (WHERE was_modified IS NOT NULL),
    COUNT(*) FILTER (WHERE was_modified = true)
  INTO v_total, v_modified
  FROM shiwake_records
  WHERE workspace_id = p_workspace_id
    AND approved_at >= v_since;

  SELECT jsonb_build_object(
    'debit_account',  100 - (COUNT(*) FILTER (WHERE 'debit_account' = ANY(modified_fields))) * 100.0 / NULLIF(v_total, 0),
    'credit_account', 100 - (COUNT(*) FILTER (WHERE 'credit_account' = ANY(modified_fields))) * 100.0 / NULLIF(v_total, 0),
    'tax_category',   100 - (COUNT(*) FILTER (WHERE 'tax_category' = ANY(modified_fields))) * 100.0 / NULLIF(v_total, 0),
    'memo',           100 - (COUNT(*) FILTER (WHERE 'memo' = ANY(modified_fields))) * 100.0 / NULLIF(v_total, 0)
  ) INTO v_field_acc
  FROM shiwake_records
  WHERE workspace_id = p_workspace_id AND approved_at >= v_since;

  SELECT jsonb_agg(jsonb_build_object('field', f, 'count', c) ORDER BY c DESC)
  INTO v_trend
  FROM (
    SELECT unnest(modified_fields) AS f, COUNT(*) AS c
    FROM shiwake_records
    WHERE workspace_id = p_workspace_id AND approved_at >= v_since AND modified_fields IS NOT NULL
    GROUP BY f
  ) t;

  RETURN jsonb_build_object(
    'period', p_period,
    'total_approved', v_total,
    'total_modified', v_modified,
    'trust_score', CASE WHEN v_total > 0 THEN (v_total - v_modified) * 100.0 / v_total ELSE NULL END,
    'field_accuracy', v_field_acc,
    'modification_trend', v_trend
  );
END;
$$ LANGUAGE plpgsql;
