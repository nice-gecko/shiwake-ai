-- v2.4.1: 弥生形式の貸方科目別分割モード
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS auto_export_yayoi_split_mode TEXT NOT NULL DEFAULT 'single';
