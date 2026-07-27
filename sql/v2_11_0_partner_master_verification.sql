-- v2.11.0 L2: 取引先名の実体確認（国税庁 法人番号Web-API）用カラム追加
-- 実行場所: Supabase SQL Editor (shiwake-ai / tmddairlgpyinqfekkfg)
-- 実行前確認: SELECT current_database(); → shiwake-ai であること
--
-- ★★ 実行方法: 必ず「単文ずつ」実行すること ★★
--   Supabase SQL Editor は複数文を一括実行すると最後の文の結果しか表示されないため、
--   ALTER を1本ずつ流し、そのつど成功を確認してから次へ進むこと。
--   最後の確認クエリ（末尾）で4カラムが揃ったことを目視すること。
--
-- 影響: すべて NULL 許容の ADD COLUMN のみ。既存行・既存クエリへの影響なし。
--   ・partner_master.title は一切変更しない（shiwake_records.matched_master_key との結合キーのため）
--   ・calc_master_attribution RPC は無変更で動作する（参照列を増やしていない）
--   ・master.js upsertMaster の PATCH は列を明示列挙しているため、
--     通常の承認・上書きで下記4カラムが消えることはない

-- 1) 法人番号（13桁）。verified 時のみ入る
ALTER TABLE public.partner_master ADD COLUMN IF NOT EXISTS corporate_number text;

-- 2) 確認状態: 'verified' | 'ambiguous' | 'not_found' | 'error' | NULL(未確認)
--    ※ 'not_found' は異常ではない（個人事業主・屋号は法人番号を持たない）
ALTER TABLE public.partner_master ADD COLUMN IF NOT EXISTS verified_status text;

-- 3) 国税庁側の正式名称。title は書き換えず、こちらに保持して UI で併記する
ALTER TABLE public.partner_master ADD COLUMN IF NOT EXISTS verified_name text;

-- 4) 確認日時
ALTER TABLE public.partner_master ADD COLUMN IF NOT EXISTS verified_at timestamptz;

-- 5) 確認結果の目視（単文で実行）
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name   = 'partner_master'
   AND column_name IN ('corporate_number','verified_status','verified_name','verified_at')
 ORDER BY column_name;

-- 6) 適用後の状況確認（任意・単文で実行）
-- SELECT verified_status, COUNT(*) FROM public.partner_master GROUP BY verified_status;
