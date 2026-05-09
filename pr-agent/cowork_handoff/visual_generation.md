# Cowork 指示書: ビジュアル素材の生成・追加

## あなたの役割

MaterialScout が「画像在庫なし（cowork_needed=True）」を返した場合、
Adobe Firefly MCP または既存素材の加工で投稿用画像を準備し、
Supabase Storage に追加して `visual_assets` テーブルに登録する。

---

## 実行タイミング

- Pipeline ログや Discord 通知に「⚠️ Cowork 必要」が表示されたとき
- または DSKさんから「画像を作って」「ビジュアルが必要」と依頼されたとき

---

## 手順

### Step 1: 不足している素材の確認

DSKさんから以下の情報を受け取る（または Pipeline ログから読み取る）:
- **persona_id**: どのペルソナ向けか（P1–P4）
- **weapon_id**: どの構文向けか（W1–W6）
- **platform**: どのプラットフォーム向けか

### Step 2: 画像生成（Adobe Firefly MCP）

Adobe Firefly MCP が利用可能な場合、以下の方針で生成する:

| weapon_id | 推奨ビジュアル方針 |
|---|---|
| W1 常識破壊 | 対比的・インパクトある構図。旧来 vs 新しい比較イメージ |
| W2 比較構造 | 表・グラフ風のクリーンなデザイン |
| W3 専門知識 | プロフェッショナルな雰囲気。書類・電卓・PCなど |
| W4 エモ独白 | 温かみのある人物・シーン写真風 |
| W5 巻き込み | 問いかけを視覚化。吹き出し・コメント欄風 |
| W6 パニック | コミカル・大げさなリアクション |

生成後のファイルを DSKさんに確認してもらう（PII が含まれていないか）。

### Step 3: Supabase Storage にアップロード

1. ファイル名を `{三桁連番}_{カテゴリ}_{説明}.png` 形式で命名
   例: `013_dashboard_comparison_w2.png`
2. Supabase ダッシュボード → Storage → `visuals-bucket` → `raw/manual/` にアップロード
3. または PR Agent の upload スクリプトを使用:
   ```bash
   # pr-agent/visuals/raw/manual/ に配置してから
   uv run python -m visuals.upload_assets
   ```

### Step 4: visual_assets テーブルに登録

Supabase SQL Editor で実行:

```sql
INSERT INTO visual_assets (
  storage_path, source, category, tags,
  weapon_compatibility, persona_fit,
  description, has_pii, masking_required
) VALUES (
  'raw/manual/013_dashboard_comparison_w2.png',
  'generated',                          -- 'manual' | 'generated'
  'dashboard',                          -- カテゴリ
  ARRAY['comparison', 'w2'],            -- タグ
  ARRAY['W2'],                          -- weapon_compatibility
  ARRAY['P1', 'P2', 'P3'],             -- persona_fit
  '比較表 — 手入力 vs shiwake-ai の工数対比',
  false,                                -- has_pii
  false                                 -- masking_required
);
```

### Step 5: Pipeline に再実行を依頼

登録完了後、DSKさんに:
「`visual_assets` に追加しました。次回の Pipeline 実行から自動選定されます」と報告する。

---

## 既存素材の加工（Adobe MCP 不要の場合）

`pr-agent/visuals/ui_annotator.py` の `add_arrow()` / `mask_region()` を使って
既存の 12枚スクリーンショットに注釈を加える方法:

```bash
uv run python -m visuals.ui_annotator --batch-test
# /tmp/annotated/ に確認用画像が出力される
```

MASK_REGIONS の座標を調整したい場合は `visuals/ui_annotator.py` の
該当 `(x1, y1, x2, y2)` 値を修正して再実行する。

---

## 注意事項

- **PII チェック必須**: 顧客名・金額・個人情報が映り込んでいないか必ず確認
- **競合社名チェック**: 弥生・freee・マネフォのロゴや名前が含まれていないか確認
- `masking_required=true` のままアップロードしない（Scout が除外するため）
- 生成画像はすべて DSKさんが最終確認してから登録する
