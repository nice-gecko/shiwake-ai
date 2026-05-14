-- v2.6.0: 自動承認機能 スキーマ追加
-- 実行場所: Supabase SQL Editor (shiwake-ai / tmddairlgpyinqfekkfg)
-- 実行前確認: SELECT current_database(); → shiwake-ai であること
-- 実行はユーザーが手動で行うこと（Claude Code は実行しない）

-- =============================================
-- 1. workspaces に自動承認設定カラムを追加
-- =============================================

-- 信頼度ゲート解放トグル（初期 OFF。解放されてもユーザーが手動ON）
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS auto_approve_learned_enabled  BOOLEAN     DEFAULT FALSE;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS auto_approve_all_enabled      BOOLEAN     DEFAULT FALSE;

-- 各ゲートが解放された日時（80%達成時 / 95%達成時に server.js が書き込む）
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS auto_approve_learned_unlocked_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS auto_approve_all_unlocked_at     TIMESTAMPTZ DEFAULT NULL;

-- 信頼度リセット基準日（この日時以降の承認のみで信頼度を再計算。NULL = 全期間）
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS trust_reset_at               TIMESTAMPTZ DEFAULT NULL;

-- 異常時の一時停止タイムスタンプ（NULL = 停止なし。信頼度が閾値割れ時に server.js が書き込む）
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS auto_approve_paused_at       TIMESTAMPTZ DEFAULT NULL;


-- =============================================
-- 2. shiwake_records に自動承認識別カラムを追加
-- =============================================

-- 自動承認されたレコードかどうか（手動承認は FALSE のまま）
ALTER TABLE shiwake_records ADD COLUMN IF NOT EXISTS auto_approved           BOOLEAN     DEFAULT FALSE;

-- どのゲートで自動承認されたか ('learned' / 'all' / NULL)
ALTER TABLE shiwake_records ADD COLUMN IF NOT EXISTS auto_approve_type       TEXT        DEFAULT NULL;

-- 自動承認時に適用された learned_rules.id（'learned'ゲート時のみ設定）
ALTER TABLE shiwake_records ADD COLUMN IF NOT EXISTS applied_learned_rule_id UUID        DEFAULT NULL
  REFERENCES learned_rules(id) ON DELETE SET NULL;

-- 自動承認ログ画面向けインデックス（自動承認件数の高速集計用）
CREATE INDEX IF NOT EXISTS idx_shiwake_records_auto_approved
  ON shiwake_records (workspace_id, auto_approved, approved_at DESC)
  WHERE auto_approved = TRUE;


-- =============================================
-- 3. calc_trust_metrics RPC を trust_reset_at 対応に更新
-- =============================================
-- trust_reset_at を使った「リセット後の信頼度」を計算するため、
-- 新パラメータ p_reset_at を追加。
-- 呼び出し側 (server.js の recalculateTrustMetrics) も合わせて更新が必要。

CREATE OR REPLACE FUNCTION calc_trust_metrics(
  p_workspace_id UUID,
  p_period       TEXT,
  p_reset_at     TIMESTAMPTZ DEFAULT NULL  -- NULL = 従来動作を維持
)
RETURNS JSONB AS $$
DECLARE
  v_since TIMESTAMPTZ;
  v_total INTEGER;
  v_modified INTEGER;
  v_field_acc JSONB;
  v_trend JSONB;
BEGIN
  -- p_reset_at が指定されている場合は reset 日時を基準日とする（p_period より優先）
  IF p_reset_at IS NOT NULL THEN
    v_since := p_reset_at;
  ELSE
    v_since := CASE WHEN p_period = 'recent'
                     THEN NOW() - INTERVAL '30 days'
                     ELSE '1900-01-01'::TIMESTAMPTZ
                END;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE was_modified IS NOT NULL),
    COUNT(*) FILTER (WHERE was_modified = true)
  INTO v_total, v_modified
  FROM shiwake_records
  WHERE workspace_id = p_workspace_id
    AND approved_at >= v_since;

  SELECT jsonb_build_object(
    'debit_account',  100 - (COUNT(*) FILTER (WHERE 'debit_account'  = ANY(modified_fields))) * 100.0 / NULLIF(v_total, 0),
    'credit_account', 100 - (COUNT(*) FILTER (WHERE 'credit_account' = ANY(modified_fields))) * 100.0 / NULLIF(v_total, 0),
    'tax_category',   100 - (COUNT(*) FILTER (WHERE 'tax_category'   = ANY(modified_fields))) * 100.0 / NULLIF(v_total, 0),
    'memo',           100 - (COUNT(*) FILTER (WHERE 'memo'           = ANY(modified_fields))) * 100.0 / NULLIF(v_total, 0)
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
    'period',            p_period,
    'total_approved',    v_total,
    'total_modified',    v_modified,
    'trust_score',       CASE WHEN v_total > 0 THEN (v_total - v_modified) * 100.0 / v_total ELSE NULL END,
    'field_accuracy',    v_field_acc,
    'modification_trend', v_trend
  );
END;
$$ LANGUAGE plpgsql;
