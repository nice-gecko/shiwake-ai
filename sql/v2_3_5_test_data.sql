-- v2.3.5 未振り分けトレイUI: 動作確認用テストデータ
-- 実行環境: Supabase SQL Editor (shiwake-ai / tmddairlgpyinqfekkfg)
-- ⚠ 実行前に SELECT current_database(); で接続先を確認してください

DO $$
DECLARE
  raw_uid TEXT := '6eZXyCx56ccpL2K4dYlUiYhrmbc2';  -- ← 自分の Firebase UID に変更してから実行
  test_uid TEXT;
  ws_id UUID;
BEGIN
  -- ガード: 未置換チェック
  IF raw_uid = 'YOUR_UID_HERE' THEN
    RAISE EXCEPTION 'test_uid を自分の Firebase UID に書き換えてから実行してください';
  END IF;
  test_uid := raw_uid;

  -- デフォルト WS 取得(なければ NULL のまま)
  SELECT id INTO ws_id
  FROM workspaces
  WHERE owner_uid = test_uid AND is_archived = false
  ORDER BY is_default DESC
  LIMIT 1;

  -- ===== 未振り分け 3件 (workspace_id IS NULL) =====

  -- 1件目: メール由来 / no_matching_rule
  INSERT INTO inbox_files
    (uid, source, source_id, filename, byte_size, storage_path, mime_type, status, created_at, subject, sender, unassigned_reason, workspace_id)
  VALUES (
    test_uid, 'email', 'test-email-001',
    'invoice_2026_01.pdf', 102400,
    'uploads/' || test_uid || '/invoice_2026_01.pdf',
    'application/pdf', 'pending',
    NOW() - INTERVAL '3 hours',
    '【請求書】2026年1月分',
    'vendor@example.com',
    'no_matching_rule',
    NULL
  );

  -- 2件目: Dropbox由来 / no_matching_rule
  INSERT INTO inbox_files
    (uid, source, source_id, filename, byte_size, storage_path, mime_type, status, created_at, subject, sender, unassigned_reason, workspace_id)
  VALUES (
    test_uid, 'dropbox', 'test-dropbox-abc123',
    'receipt_konbini.jpg', 204800,
    'uploads/' || test_uid || '/receipt_konbini.jpg',
    'image/jpeg', 'pending',
    NOW() - INTERVAL '1 day',
    NULL,
    '/領収書/コンビニ/',
    'no_matching_rule',
    NULL
  );

  -- 3件目: Google Drive由来 / no_workspace_setup
  INSERT INTO inbox_files
    (uid, source, source_id, filename, byte_size, storage_path, mime_type, status, created_at, subject, sender, unassigned_reason, workspace_id)
  VALUES (
    test_uid, 'gdrive', 'test-gdrive-xyz789',
    'estimate_2026.pdf', 153600,
    'uploads/' || test_uid || '/estimate_2026.pdf',
    'application/pdf', 'pending',
    NOW() - INTERVAL '5 days',
    NULL,
    '/見積書フォルダ/',
    'no_workspace_setup',
    NULL
  );

  -- ===== 振り分け済み 2件 (workspace_id IS NOT NULL, 過去14日以内) =====

  -- 4件目: メール由来・振り分け済み
  INSERT INTO inbox_files
    (uid, source, source_id, filename, byte_size, storage_path, mime_type, status, created_at, subject, sender, unassigned_reason, workspace_id)
  VALUES (
    test_uid, 'email', 'test-email-assigned-001',
    'receipt_taxi.pdf', 98304,
    'uploads/' || test_uid || '/receipt_taxi.pdf',
    'application/pdf', 'pending',
    NOW() - INTERVAL '2 days',
    '領収書: タクシー代',
    'receipt@taxi.example.com',
    NULL,
    ws_id
  );

  -- 5件目: Dropbox由来・振り分け済み
  INSERT INTO inbox_files
    (uid, source, source_id, filename, byte_size, storage_path, mime_type, status, created_at, subject, sender, unassigned_reason, workspace_id)
  VALUES (
    test_uid, 'dropbox', 'test-dropbox-assigned-002',
    'invoice_office.png', 307200,
    'uploads/' || test_uid || '/invoice_office.png',
    'image/png', 'pending',
    NOW() - INTERVAL '7 days',
    NULL,
    '/オフィス費/',
    NULL,
    ws_id
  );

  RAISE NOTICE 'テストデータINSERT完了 (uid=%, ws_id=%)', test_uid, ws_id;
END $$;
