-- v2.7.1 P2-α: 1:N マッチング（カード引落の合計照合）
-- 通帳の引落行から、対応するカード明細ソースへのリンクを保存する
--
-- 実行: Supabase SQL Editor で本ファイル全文を貼り付けて実行
-- 冪等性: IF NOT EXISTS で 2回実行しても安全

ALTER TABLE reconciliation_entries
  ADD COLUMN IF NOT EXISTS linked_card_source_id UUID NULL
  REFERENCES reconciliation_sources(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_recon_entries_linked_card
  ON reconciliation_entries(linked_card_source_id);
