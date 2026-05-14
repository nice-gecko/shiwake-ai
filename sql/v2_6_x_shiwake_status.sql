-- v2.6.x: shiwake_records に status 列を新設（差し戻し受け皿）
-- 実行場所: Supabase SQL Editor (shiwake-ai / tmddairlgpyinqfekkfg)
-- 実行前確認: SELECT current_database(); → shiwake-ai であること
-- 実行はユーザーが手動で行うこと（Claude Code は実行しない）

-- =============================================
-- 1. status 列の追加
-- =============================================
-- 値の仕様:
--   'approved'    : 通常承認済み（手動・自動どちらも）
--   'reverted'    : 差し戻し済み（再レビュー待ち）
--   're_approved' : 差し戻し後に再承認済み
--
-- DEFAULT 'approved' にすることで、既存レコード全件が自動的に 'approved' 扱いになる。
-- UPDATE による backfill は不要。
--
-- CHECK 制約で値を3種に限定する（typo・バグによる不正値を防ぐ）。

ALTER TABLE shiwake_records
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved'
  CHECK (status IN ('approved', 'reverted', 're_approved'));

-- =============================================
-- 2. 既存レコードの backfill
-- =============================================
-- DEFAULT 'approved' で新規/既存ともに自動的に 'approved' になるため不要。
-- （参考: NULL になる可能性はなく、明示的 UPDATE は省略してよい）

-- =============================================
-- 3. インデックス
-- =============================================
-- status での絞り込みが発生するクエリ:
--   - エクスポート対象取得 (status != 'reverted')
--   - 再レビュー画面 (status = 'reverted')
--   - 信頼度計算 (status = 'approved' or 're_approved')
--
-- 'reverted' は件数が少ない想定なので部分インデックスで十分。
-- 'approved'/'re_approved' が多数を占めるため、通常クエリは workspace_id + exported_at の
-- 既存インデックスで賄い、status は filter として追加する形が効率的。

-- 差し戻しレコード一覧（再レビュー画面用）
CREATE INDEX IF NOT EXISTS idx_shiwake_records_reverted
  ON shiwake_records (workspace_id, status)
  WHERE status = 'reverted';

-- 自動承認ログ画面（既存 idx_shiwake_records_auto_approved）との整合は維持済み。
-- calc_trust_metrics RPC も status で絞る場合は次フェーズで関数更新が必要（後述メモ参照）。
