-- v2.3.0: 自動取り込み機能 (Auto Intake)
-- 実行済み: Supabase ダッシュボードで手動適用

-- 新規テーブル: 受信ファイルキュー
CREATE TABLE IF NOT EXISTS inbox_files (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uid            text NOT NULL,
  source         text NOT NULL,          -- 'email' | 'dropbox' | 'gdrive'
  source_id      text,                   -- provider固有ID (dedup用)
  file_name      text NOT NULL,
  storage_path   text NOT NULL,          -- Supabase Storage: inbox-files/{uid}/{uuid}/{filename}
  content_type   text,
  file_size      bigint,
  status         text NOT NULL DEFAULT 'pending',  -- pending | processing | done | archived
  shiwake_id     text,                   -- 仕訳完了後にセット
  received_at    timestamptz NOT NULL DEFAULT now(),
  processed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- 新規テーブル: メール受信アドレス管理
CREATE TABLE IF NOT EXISTS inbox_addresses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uid        text NOT NULL UNIQUE,
  local_part text NOT NULL UNIQUE,       -- メールアドレスのローカル部
  is_active  boolean NOT NULL DEFAULT true,
  issued_at  timestamptz NOT NULL DEFAULT now()
);

-- 新規テーブル: クラウドストレージ接続設定
CREATE TABLE IF NOT EXISTS cloud_connections (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uid                text NOT NULL,
  provider           text NOT NULL,      -- 'dropbox' | 'gdrive'
  access_token       text,
  refresh_token      text,
  folder_path        text,               -- Dropbox用
  folder_id          text,               -- GDrive用
  is_active          boolean NOT NULL DEFAULT true,
  channel_id         text,               -- GDrive Push通知 channel_id
  channel_expires_at timestamptz,        -- GDrive Push通知 有効期限
  connected_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(uid, provider)
);

-- usersテーブルへの列追加
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auto_intake_enabled  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_shiwake_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS graduated_rookie_at  timestamptz,
  ADD COLUMN IF NOT EXISTS cumulative_shiwake_count integer NOT NULL DEFAULT 0;

-- Supabase Storage バケット (ダッシュボードで手動作成)
-- バケット名: inbox-files
-- アクセス: private (service_role keyのみ)
