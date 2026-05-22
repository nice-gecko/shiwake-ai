-- v2.7.2 P2-β: N:1 マッチング（まとめ払いの組み合わせ照合）
-- 通帳1行 vs 同一取引先の未照合 shiwake_records 複数件の組み合わせ照合
--
-- linked_record_ids: 自動 matched 時に確定した shiwake_records の組
-- candidate_combinations: 複数候補時、ユーザー判断待ちの組み合わせ群
--   形式 [{"record_ids":["uuid","uuid"],"total":N,"diff":N}, ...]
--
-- 実行: Supabase SQL Editor で本ファイル全文を貼り付けて実行
-- 冪等性: IF NOT EXISTS で 2回実行しても安全

ALTER TABLE reconciliation_entries
  ADD COLUMN IF NOT EXISTS linked_record_ids UUID[] NULL;

ALTER TABLE reconciliation_entries
  ADD COLUMN IF NOT EXISTS candidate_combinations JSONB NULL;
