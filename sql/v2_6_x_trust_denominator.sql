-- v2.6.x: trust_denominator 列追加 + calc_trust_metrics 分母方式への改修
-- 実行場所: Supabase SQL Editor (shiwake-ai / tmddairlgpyinqfekkfg)
-- 実行前確認: SELECT current_database(); → shiwake-ai であること
-- 実行はユーザーが手動で行うこと（Claude Code は実行しない）
--
-- 変更内容:
--   1. workspaces に trust_denominator 列を追加
--      INTEGER / NOT NULL / DEFAULT 30 / CHECK (trust_denominator >= 1)
--      ※ CHECK 上限は設けない（WS によって 30 件超の分母を使うユースケースを妨げない）
--
--   2. 旧3引数版 calc_trust_metrics(UUID, TEXT, TIMESTAMPTZ) を DROP
--      → 4引数版と共存するとオーバーロード曖昧エラーになるため先に削除
--
--   3. 新4引数版 calc_trust_metrics を CREATE
--      p_denominator INTEGER DEFAULT 30 を追加（後方互換維持）
--      trust_score を精度率モデル → 分母方式に変更
--        変更前: (修正なし承認件数) / (全承認件数) × 100
--        変更後: LEAST(99, (修正なし承認件数)::numeric / p_denominator × 100)


-- =============================================
-- 1. workspaces テーブルに trust_denominator 列を追加
-- =============================================
-- CHECK (trust_denominator >= 1):
--   p_denominator <= 0 の防御を DB レベルでも担保する。
--   上限は設けない（運用次第で 30 を超える分母を使う WS を排除しない）。

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS trust_denominator INTEGER NOT NULL DEFAULT 30
  CHECK (trust_denominator >= 1);


-- =============================================
-- 2. 旧3引数版を明示的に DROP
-- =============================================
-- ※ CREATE OR REPLACE では引数の異なる同名関数は上書きされず新規オーバーロードになる。
--   旧版を残すと server.js からの 2〜3 引数呼び出しが ambiguous error になるため先に削除。

DROP FUNCTION IF EXISTS calc_trust_metrics(UUID, TEXT, TIMESTAMPTZ);


-- =============================================
-- 3. 新4引数版 calc_trust_metrics を CREATE
-- =============================================
-- 後方互換:
--   p_reset_at     DEFAULT NULL  → 旧2引数 (recent) 呼び出しは p_reset_at を省略できる
--   p_denominator  DEFAULT 30    → server.js が第2段で p_denominator を渡すまで DEFAULT 30 で動く
--
-- trust_score:
--   「修正なし承認件数」= status != 'reverted' AND was_modified = false の件数
--   新計算式: LEAST(99, v_unmodified::numeric / p_denominator × 100)
--   データゼロ時は NULL を返す（旧動作と同じ）
--
-- field_accuracy:
--   従来通り「率」（全承認件数分の修正なし率）のまま維持する。
--   分母方式に変えるのは trust_score のみ。

CREATE OR REPLACE FUNCTION calc_trust_metrics(
  p_workspace_id UUID,
  p_period       TEXT,
  p_reset_at     TIMESTAMPTZ DEFAULT NULL,  -- NULL = 従来動作（全期間 or 直近30日）
  p_denominator  INTEGER     DEFAULT 30     -- WS ごとの分母（workspaces.trust_denominator から渡す）
)
RETURNS JSONB AS $$
DECLARE
  v_since      TIMESTAMPTZ;
  v_total      INTEGER;  -- was_modified IS NOT NULL の全承認件数（field_accuracy 分母）
  v_modified   INTEGER;  -- was_modified = true の件数
  v_unmodified INTEGER;  -- 修正なし承認件数（= v_total - v_modified、trust_score の分子）
  v_field_acc  JSONB;
  v_trend      JSONB;
BEGIN
  -- 防御: p_denominator が不正値の場合は NULL を返す
  -- （CHECK 制約で担保済みだが、直接 RPC 呼び出し時のフォールバックとして維持）
  IF p_denominator <= 0 THEN
    RETURN NULL;
  END IF;

  -- p_period から基準日を設定（p_reset_at とは独立して常に計算）
  v_since := CASE WHEN p_period = 'recent'
                   THEN NOW() - INTERVAL '30 days'
                   ELSE '1900-01-01'::TIMESTAMPTZ
              END;

  -- 集計: v_since と p_reset_at の両方を AND で満たすレコードのみ対象
  --   ・status != 'reverted'  : 差し戻し済みを除外（前回フィルタを維持）
  --   ・approved_at >= v_since : period フィルタ
  --   ・(p_reset_at IS NULL OR approved_at >= p_reset_at) : リセット日時以降に絞る
  SELECT
    COUNT(*) FILTER (WHERE was_modified IS NOT NULL),
    COUNT(*) FILTER (WHERE was_modified = true)
  INTO v_total, v_modified
  FROM shiwake_records
  WHERE workspace_id = p_workspace_id
    AND status != 'reverted'
    AND approved_at >= v_since
    AND (p_reset_at IS NULL OR approved_at >= p_reset_at);

  -- 修正なし承認件数（trust_score の分子）
  v_unmodified := v_total - v_modified;

  -- field_accuracy: 従来通り「率」のまま（分母方式に変えない）
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
    'period',             p_period,
    'total_approved',     v_total,
    'total_modified',     v_modified,
    'trust_score',        CASE WHEN v_total > 0
                            THEN LEAST(99, v_unmodified::numeric / p_denominator * 100)
                            ELSE NULL
                          END,
    'field_accuracy',     v_field_acc,
    'modification_trend', v_trend
  );
END;
$$ LANGUAGE plpgsql;
