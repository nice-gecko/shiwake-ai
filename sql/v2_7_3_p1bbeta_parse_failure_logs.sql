-- v2.7.3 P1B-β: パース失敗ログ収集
-- 突合機能の CSV/PDF/写真パース失敗時に、ユーザー同意ベースで失敗データを収集する。
-- 目的: csv_formats.json の更新やフォーマット対応拡充の手がかり収集。
--
-- 実行: Supabase SQL Editor で本ファイル全文を貼り付けて実行
-- 冪等性: IF NOT EXISTS / CREATE POLICY は冪等でないので 2回目は CREATE POLICY 部分でエラー
--         （その場合は失敗箇所のみスキップして OK）

CREATE TABLE IF NOT EXISTS parse_failure_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  source_type TEXT NOT NULL,         -- 'bank' | 'card'
  institution_name TEXT NULL,
  mime_type TEXT NOT NULL,           -- 'text/csv' | 'application/pdf' | 'image/jpeg' etc
  failure_type TEXT NOT NULL,        -- 'exception' | 'empty_result'
  error_message TEXT NULL,
  file_size INTEGER NULL,
  file_name TEXT NULL,
  file_content TEXT NULL,            -- CSV 全文（同意時のみ・テキスト）
  user_consented BOOLEAN NOT NULL DEFAULT false,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ NULL,
  resolved_note TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_parse_failure_logs_workspace  ON parse_failure_logs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_parse_failure_logs_failed_at  ON parse_failure_logs(failed_at DESC);
CREATE INDEX IF NOT EXISTS idx_parse_failure_logs_unresolved ON parse_failure_logs(failed_at DESC) WHERE resolved_at IS NULL;

-- RLS: workspace owner のみ自分のログを読める（書き込みはサーバ経由のみ）
ALTER TABLE parse_failure_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS parse_failure_logs_select_own ON parse_failure_logs;
CREATE POLICY parse_failure_logs_select_own ON parse_failure_logs
  FOR SELECT
  USING (workspace_id IN (SELECT id FROM workspaces WHERE owner_uid = auth.uid()::text));

-- ユーザーのオプトイン設定: 「今後も同意」のデフォルト値
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS parse_failure_consent_default BOOLEAN NOT NULL DEFAULT false;
