-- v2.6.0: shiwake_records.status 列を後追いでSQLファイル化
-- 実行場所: Supabase SQL Editor (shiwake-ai / tmddairlgpyinqfekkfg)
-- 実行前確認: SELECT current_database(); → shiwake-ai であること
-- 実行はユーザーが手動で行うこと（Claude Code は実行しない）
--
-- =============================================
-- 【後追い記録】本番適用済み列のドキュメント化
-- =============================================
-- このファイルは、本番DB（Supabase: tmddairlgpyinqfekkfg）に
-- 既に直接適用済みの列を、記録目的で後追いファイル化したものです。
--
-- 適用済み: v2.6.0 / 2026-05-14 セッション（Phase 4 自動承認実装時）
--
-- status 列の取りうる値:
--   'approved'    : 通常承認済み（手動・自動どちらも）
--   'reverted'    : 差し戻し済み（再レビュー待ち）
--   're_approved' : 差し戻し後に再承認済み
--
-- 注意: 本番の CHECK 制約有無は未確認。
--       このファイルでは CHECK 制約を付けていない。
--       確認したい場合は以下を実行:
--         SELECT pg_get_constraintdef(c.oid)
--         FROM pg_constraint c
--         JOIN pg_class t ON c.conrelid = t.oid
--         WHERE t.relname = 'shiwake_records' AND c.contype = 'c';
-- =============================================

ALTER TABLE public.shiwake_records
  ADD COLUMN IF NOT EXISTS status TEXT;
