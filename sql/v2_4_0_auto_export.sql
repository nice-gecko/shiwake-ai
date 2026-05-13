-- ===== v2.4.0 自動エクスポート スキーマ確認 + DB変更 =====
-- プロジェクト: shiwake-ai (tmddairlgpyinqfekkfg)
-- ユーザーが Supabase SQL Editor で実行すること

-- ■ Step 0: 実行前スキーマ確認(参照のみ、変更なし)
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name IN ('shiwake_records', 'workspaces')
-- ORDER BY table_name, ordinal_position;

-- ■ Step 1: shiwake_records に exported_at カラム追加
ALTER TABLE shiwake_records ADD COLUMN IF NOT EXISTS exported_at TIMESTAMPTZ NULL;

-- 未エクスポート件数高速取得用 部分インデックス
CREATE INDEX IF NOT EXISTS idx_shiwake_records_unexported
  ON shiwake_records (uid, workspace_id)
  WHERE exported_at IS NULL;

-- ■ Step 2: shiwake_exports テーブル新設
CREATE TABLE IF NOT EXISTS shiwake_exports (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  uid                 TEXT         NOT NULL,
  workspace_id        UUID         NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  triggered_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ  NULL,
  status              TEXT         NOT NULL DEFAULT 'pending',
  output_destinations JSONB        NOT NULL,
  record_count        INTEGER      NOT NULL,
  output_format       TEXT         NOT NULL,
  output_unit         TEXT         NOT NULL,
  csv_storage_path    TEXT         NULL,
  error_message       TEXT         NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 履歴一覧取得用インデックス
CREATE INDEX IF NOT EXISTS idx_shiwake_exports_uid_created
  ON shiwake_exports (uid, created_at DESC);

-- ■ Step 3: workspaces に自動エクスポート設定カラム追加
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS auto_export_enabled          BOOLEAN  NOT NULL DEFAULT FALSE;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS auto_export_threshold         INTEGER  NOT NULL DEFAULT 30;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS auto_export_output_unit       TEXT     NOT NULL DEFAULT 'per_workspace';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS auto_export_destinations      JSONB    NOT NULL DEFAULT '["email"]'::jsonb;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS auto_export_cloud_folder_path TEXT     NULL;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS auto_export_format            TEXT     NOT NULL DEFAULT 'yayoi';
