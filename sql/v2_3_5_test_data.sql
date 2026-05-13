-- v2.3.5 未振り分けトレイUI: 動作確認用テストデータ
-- 実行環境: Supabase SQL Editor (shiwake-ai / tmddairlgpyinqfekkfg)
-- ⚠ uid は実際のFirebase UIDに差し替えてから実行してください
-- ⚠ 実行前に SELECT current_database(); で接続先を確認してください

-- 【変数定義】自分のUIDに書き換える
-- UID例: 'xxxxxxxxxxxxxxxxxxxxxxxx'
DO $$
DECLARE
  test_uid TEXT := 'YOUR_UID_HERE';  -- ← 自分のFirebase UIDに変更
BEGIN

-- ===== 未振り分け 3件 (workspace_id IS NULL) =====

-- 1件目: メール由来 / no_matching_rule
INSERT INTO inbox_files (uid, source, source_id, storage_path, processed_at, subject, sender, unassigned_reason, workspace_id)
VALUES (
  test_uid,
  'email',
  'test-email-001',
  'uploads/' || test_uid || '/invoice_2026_01.pdf',
  NOW() - INTERVAL '3 hours',
  '【請求書】2026年1月分',
  'vendor@example.com',
  'no_matching_rule',
  NULL
);

-- 2件目: Dropbox由来 / no_matching_rule
INSERT INTO inbox_files (uid, source, source_id, storage_path, processed_at, subject, sender, unassigned_reason, workspace_id)
VALUES (
  test_uid,
  'dropbox',
  'test-dropbox-abc123',
  'uploads/' || test_uid || '/receipt_konbini.jpg',
  NOW() - INTERVAL '1 day',
  NULL,
  '/領収書/コンビニ/',
  'no_matching_rule',
  NULL
);

-- 3件目: Google Drive由来 / no_workspace_setup
INSERT INTO inbox_files (uid, source, source_id, storage_path, processed_at, subject, sender, unassigned_reason, workspace_id)
VALUES (
  test_uid,
  'gdrive',
  'test-gdrive-xyz789',
  'uploads/' || test_uid || '/estimate_2026.pdf',
  NOW() - INTERVAL '5 days',
  NULL,
  '/見積書フォルダ/',
  'no_workspace_setup',
  NULL
);

-- ===== 振り分け済み 2件 (workspace_id IS NOT NULL, 過去14日以内) =====
-- ※ workspace_id は実際に存在するWSのIDに差し替えてください
-- 下記は仮のUUID。実際のUIDに合わせて書き換えること

-- 4件目: メール由来・振り分け済み
INSERT INTO inbox_files (uid, source, source_id, storage_path, processed_at, subject, sender, unassigned_reason, workspace_id)
VALUES (
  test_uid,
  'email',
  'test-email-assigned-001',
  'uploads/' || test_uid || '/receipt_taxi.pdf',
  NOW() - INTERVAL '2 days',
  '領収書: タクシー代',
  'receipt@taxi.example.com',
  NULL,
  (SELECT id FROM workspaces WHERE owner_uid = test_uid AND is_archived = false ORDER BY is_default DESC LIMIT 1)
);

-- 5件目: Dropbox由来・振り分け済み
INSERT INTO inbox_files (uid, source, source_id, storage_path, processed_at, subject, sender, unassigned_reason, workspace_id)
VALUES (
  test_uid,
  'dropbox',
  'test-dropbox-assigned-002',
  'uploads/' || test_uid || '/invoice_office.png',
  NOW() - INTERVAL '7 days',
  NULL,
  '/オフィス費/',
  NULL,
  (SELECT id FROM workspaces WHERE owner_uid = test_uid AND is_archived = false ORDER BY is_default DESC LIMIT 1)
);

RAISE NOTICE 'テストデータINSERT完了 (uid=%)', test_uid;
END $$;
