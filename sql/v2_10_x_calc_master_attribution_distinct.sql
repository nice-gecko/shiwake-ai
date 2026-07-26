-- v2.10 ④-1b: master_used を「使われたマスタ種類数(DISTINCT)」へ変更
-- 実行場所: Supabase SQL Editor (shiwake-ai / tmddairlgpyinqfekkfg)
-- 実行前確認: SELECT current_database(); → shiwake-ai であること
-- 実行はユーザー(DSK)が手動で行うこと（Claude Code は実行しない）
--
-- 変更点（v2_10_x_calc_master_attribution.sql / 本番DB実体 からの差分）:
--   mu CTE の COUNT(*)  →  COUNT(DISTINCT (p.workspace_id, p.title))
--     ・「使われた」判定は従来どおり: 実際の結合キー
--         shiwake_records.workspace_id      = partner_master.workspace_id
--         shiwake_records.matched_master_key = partner_master.title
--       かつ status <> 'reverted'。
--     ・同じマスタが何回ヒットしても 1（種類数）としてカウント。
--     ・partner_master は UNIQUE(workspace_id, title)=uq_partner_master_ws_title を
--       持つため、master_registered(=partner_master 行数) と同一粒度。
--       常に master_used <= master_registered を保証する。
--   master_registered / rule_registered / created_by=NULL の扱い・引数シグネチャ・
--   SECURITY INVOKER・VOLATILE は変更しない（本番DB実体に合わせる）。
--
-- 【事前調査で判明したローカルSQLと本番DBの食い違い】
--   旧ローカル v2_10_x_calc_master_attribution.sql は末尾が「LANGUAGE sql STABLE」だが、
--   本番DBの実体は VOLATILE（pg_proc.provolatile='v'）。
--   本ファイルは本番実体＆依頼の「VOLATILE指定を変更しない」に合わせ VOLATILE で統一する。

CREATE OR REPLACE FUNCTION calc_master_attribution(p_owner_uid TEXT)
RETURNS TABLE(
  created_by         TEXT,
  master_registered  BIGINT,
  rule_registered    BIGINT,
  master_used        BIGINT
)
AS $$
  WITH ws AS (
    SELECT id FROM workspaces WHERE owner_uid = p_owner_uid
  ),
  mr AS (
    SELECT pm.created_by AS cb, COUNT(*) AS cnt
    FROM partner_master pm
    WHERE pm.workspace_id IN (SELECT id FROM ws)
    GROUP BY pm.created_by
  ),
  rr AS (
    SELECT cr.created_by AS cb, COUNT(*) AS cnt
    FROM category_rules cr
    WHERE cr.workspace_id IN (SELECT id FROM ws)
    GROUP BY cr.created_by
  ),
  mu AS (
    -- v2.10 ④-1b: 回数ではなく「使われたマスタの種類数」= DISTINCT(結合キー)
    SELECT p.created_by AS cb, COUNT(DISTINCT (p.workspace_id, p.title)) AS cnt
    FROM shiwake_records s
    JOIN partner_master p
      ON s.workspace_id = p.workspace_id
     AND s.matched_master_key = p.title
    WHERE p.workspace_id IN (SELECT id FROM ws)
      AND s.status <> 'reverted'
    GROUP BY p.created_by
  ),
  keys AS (
    SELECT cb FROM mr
    UNION
    SELECT cb FROM rr
    UNION
    SELECT cb FROM mu
  )
  SELECT
    k.cb                       AS created_by,
    COALESCE(mr.cnt, 0)        AS master_registered,
    COALESCE(rr.cnt, 0)        AS rule_registered,
    COALESCE(mu.cnt, 0)        AS master_used
  FROM keys k
  LEFT JOIN mr ON mr.cb IS NOT DISTINCT FROM k.cb
  LEFT JOIN rr ON rr.cb IS NOT DISTINCT FROM k.cb
  LEFT JOIN mu ON mu.cb IS NOT DISTINCT FROM k.cb;
$$ LANGUAGE sql VOLATILE;
