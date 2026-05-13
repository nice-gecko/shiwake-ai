-- v2.3.5 未振り分けトレイUI: inbox_files テーブル拡張
-- 実行環境: Supabase SQL Editor (shiwake-ai / tmddairlgpyinqfekkfg)

-- 1. unassigned_reason 列追加
--    取りうる値: 'no_matching_rule' / 'no_workspace_setup' / 'ambiguous_match'
ALTER TABLE inbox_files ADD COLUMN IF NOT EXISTS unassigned_reason TEXT;

-- 2. subject 列追加(メール件名保存用。gdrive/Dropbox は NULL)
ALTER TABLE inbox_files ADD COLUMN IF NOT EXISTS subject TEXT;

-- 3. 未振り分け一覧クエリ (workspace_id IS NULL, uid + created_at) 用部分インデックス
CREATE INDEX IF NOT EXISTS idx_inbox_files_unassigned
  ON inbox_files (uid, created_at DESC)
  WHERE workspace_id IS NULL;

-- 4. 振り分け済み直近14日クエリ (workspace_id IS NOT NULL) 用部分インデックス
CREATE INDEX IF NOT EXISTS idx_inbox_files_assigned_recent
  ON inbox_files (uid, created_at DESC)
  WHERE workspace_id IS NOT NULL;
