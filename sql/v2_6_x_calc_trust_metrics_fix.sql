-- v2.6.x: calc_trust_metrics RPC 修正
-- 実行場所: Supabase SQL Editor (shiwake-ai / tmddairlgpyinqfekkfg)
-- 実行前確認: SELECT current_database(); → shiwake-ai であること
-- 実行はユーザーが手動で行うこと（Claude Code は実行しない）
--
-- 修正内容:
--   1. 旧2引数版 calc_trust_metrics(UUID, TEXT) を DROP
--      → 3引数版と共存するとオーバーロード曖昧エラーになるため先に削除
--   2. 3引数版を CREATE OR REPLACE
--      a) p_reset_at TIMESTAMPTZ DEFAULT NULL を追加
--         → 既存の2引数呼び出し（recent コール等）は DEFAULT NULL で後方互換維持
--         → p_reset_at が指定された場合は WHERE に追加条件として AND で連結
--      b) status != 'reverted' フィルタを追加
--         → 差し戻し済みレコードを集計から除外（信頼度の不当な水増しを防ぐ）
--         → status='approved' と status='re_approved' は集計対象のまま


-- =============================================
-- 1. 旧2引数版を明示的に DROP
-- =============================================
-- ※ CREATE OR REPLACE では引数の異なる同名関数は上書きされず新規オーバーロードになる。
-- 　 旧版を残すと recent コール（2引数）が ambiguous error になるため必ず先に削除する。

DROP FUNCTION IF EXISTS calc_trust_metrics(UUID, TEXT);


-- =============================================
-- 2. 3引数版 calc_trust_metrics を CREATE
-- =============================================

CREATE OR REPLACE FUNCTION calc_trust_metrics(
  p_workspace_id UUID,
  p_period       TEXT,
  p_reset_at     TIMESTAMPTZ DEFAULT NULL  -- NULL = 従来動作（全期間 or 直近30日）
)
RETURNS JSONB AS $$
DECLARE
  v_since    TIMESTAMPTZ;
  v_total    INTEGER;
  v_modified INTEGER;
  v_field_acc JSONB;
  v_trend    JSONB;
BEGIN
  -- p_period から基準日を設定（p_reset_at とは独立して常に計算）
  v_since := CASE WHEN p_period = 'recent'
                   THEN NOW() - INTERVAL '30 days'
                   ELSE '1900-01-01'::TIMESTAMPTZ
              END;

  -- 集計: v_since と p_reset_at の両方を AND で満たすレコードのみ対象
  --   ・status != 'reverted'  : 差し戻し済みを除外
  --   ・approved_at >= v_since : period フィルタ（recent = 30日以内 / all = 全期間）
  --   ・(p_reset_at IS NULL OR approved_at >= p_reset_at) : リセット日時以降に絞る（指定時のみ）
  SELECT
    COUNT(*) FILTER (WHERE was_modified IS NOT NULL),
    COUNT(*) FILTER (WHERE was_modified = true)
  INTO v_total, v_modified
  FROM shiwake_records
  WHERE workspace_id = p_workspace_id
    AND status != 'reverted'
    AND approved_at >= v_since
    AND (p_reset_at IS NULL OR approved_at >= p_reset_at);

  SELECT jsonb_build_object(
    'debit_account',  100 - (COUNT(*) FILTER (WHERE 'debit_account'  = ANY(modified_fields))) * 100.0 / NULLIF(v_total, 0),
    'credit_account', 100 - (COUNT(*) FILTER (WHERE 'credit_account' = ANY(modified_fields))) * 100.0 / NULLIF(v_total, 0),
    'tax_category',   100 - (COUNT(*) FILTER (WHERE 'tax_category'   = ANY(modified_fields))) * 100.0 / NULLIF(v_total, 0),
    'memo',           100 - (COUNT(*) FILTER (WHERE 'memo'           = ANY(modified_fields))) * 100.0 / NULLIF(v_total, 0)
  ) INTO v_field_acc
  FROM shiwake_records
  WHERE workspace_id = p_workspace_id
    AND status != 'reverted'
    AND approved_at >= v_since
    AND (p_reset_at IS NULL OR approved_at >= p_reset_at);

  SELECT jsonb_agg(jsonb_build_object('field', f, 'count', c) ORDER BY c DESC)
  INTO v_trend
  FROM (
    SELECT unnest(modified_fields) AS f, COUNT(*) AS c
    FROM shiwake_records
    WHERE workspace_id = p_workspace_id
      AND status != 'reverted'
      AND approved_at >= v_since
      AND (p_reset_at IS NULL OR approved_at >= p_reset_at)
      AND modified_fields IS NOT NULL
    GROUP BY f
  ) t;

  RETURN jsonb_build_object(
    'period',              p_period,
    'total_approved',      v_total,
    'total_modified',      v_modified,
    'trust_score',         CASE WHEN v_total > 0 THEN (v_total - v_modified) * 100.0 / v_total ELSE NULL END,
    'field_accuracy',      v_field_acc,
    'modification_trend',  v_trend
  );
END;
$$ LANGUAGE plpgsql;
