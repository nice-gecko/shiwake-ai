# Cowork 指示書: Adobe Firefly 画像生成 → visual_assets 投入

## あなたの役割

MaterialScout が画像在庫不足を検知した際に自動生成された依頼ファイルを処理し、
Adobe MCP (Firefly) で画像を生成して Supabase の `visual_assets` テーブルに登録する。

---

## 入力（自動生成される依頼ファイル）

`~/APP/shiwake-ai/pr-agent/dashboard/output/cowork_requests/` に以下の形式の JSON が生成される:

```json
{
  "instruction": "image_generate",
  "params": {
    "weapon_id": "W1",
    "persona_id": "P1",
    "platform": "threads",
    "firefly_prompt": "liberation from tedious work, ...",
    "negative_prompt": "text overlays, watermarks, ...",
    "aspect_ratio": "4:5",
    "weapon_compatibility": ["W1"],
    "persona_fit": ["P1"],
    "tags": ["W1", "P1", "threads"],
    "category": "generated"
  },
  "requested_at": "2026-05-09T14:30:00+09:00",
  "requested_by": "material_scout",
  "status": "pending"
}
```

---

## 作業手順

### Step 1: 未処理の依頼ファイルを確認

`cowork_requests/` ディレクトリ内の `*_image_generate.json` ファイルのうち、
`"status": "pending"` のものをすべて処理する。

---

### Step 2: Adobe Firefly で画像生成

Adobe MCP の `create_firefly_board` または `image_fill_area` / `image_generative_expand` を使用:

**使用するツール:** `adobe_mandatory_init` → `create_firefly_board`

**プロンプト指定:**
- メインプロンプト: `params.firefly_prompt`
- ネガティブプロンプト: `params.negative_prompt`
- アスペクト比: `params.aspect_ratio`（例: `"4:5"`, `"16:9"`, `"1:1"`）

**生成ガイドライン:**
- 人物の顔は映さない（シルエット or 抽象的表現）
- 競合ロゴ・テキストオーバーレイは禁止
- shiwake-ai のブランドカラー（インディゴ系）を意識

---

### Step 3: 生成画像をローカルに保存

- ファイル名: `generated_{weapon_id}_{persona_id}_{YYYY-MM-DD}.jpg`
- 保存先: `~/APP/shiwake-ai/pr-agent/dashboard/output/generated_assets/`

---

### Step 4: Supabase Storage にアップロード

```
ストレージバケット: visuals-bucket（環境変数 SUPABASE_STORAGE_BUCKET）
パス: generated/{weapon_id}/{persona_id}/{filename}
```

Supabase Studio の Storage タブ、または API 経由でアップロード:

```python
# Python での upload 例（Supabase クライアント使用）
from supabase import create_client
import os

db = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
storage_path = f"generated/{weapon_id}/{persona_id}/{filename}"
with open(local_path, "rb") as f:
    db.storage.from_("visuals-bucket").upload(storage_path, f.read())
```

---

### Step 5: visual_assets テーブルに INSERT

```sql
INSERT INTO visual_assets (
  storage_path,
  source,
  category,
  tags,
  weapon_compatibility,
  persona_fit,
  description,
  has_pii,
  masking_required
) VALUES (
  'generated/<weapon_id>/<persona_id>/<filename>',
  'generated',
  'generated',
  ARRAY['<weapon_id>', '<persona_id>', '<platform>', 'firefly'],
  ARRAY['<weapon_id>'],
  ARRAY['<persona_id>'],
  'Adobe Firefly 生成: <firefly_promptの先頭50字>',
  false,
  false
);
```

---

### Step 6: 依頼ファイルのステータスを更新

処理完了した JSON ファイルの `"status"` を `"done"` に書き換える:

```json
{
  "status": "done",
  "completed_at": "2026-05-09T15:00:00+09:00",
  "storage_path": "generated/W1/P1/generated_W1_P1_2026-05-09.jpg"
}
```

---

### Step 7: Discord 通知

```
🎨 画像生成完了
- weapon: W1 × persona: P1 × platform: threads
- ファイル: generated_W1_P1_2026-05-09.jpg
- visual_assets に登録済み
- 次回の MaterialScout から自動で使用されます
```

---

## NG 行動

| NG | 理由 |
|----|------|
| ❌ 人物の顔を生成 | プライバシーリスク |
| ❌ 競合ロゴ・ブランド名を含む画像 | ブランドリスク |
| ❌ has_pii=true で登録 | 自動使用されてしまう |
| ❌ `masking_required=true` で登録 | 同上 |
| ❌ ステータス更新を忘れる | 次回も重複処理される |

---

## 完了報告フォーマット

```
✅ 画像生成完了
- 処理件数: <件数>件
- 生成画像: <ファイル名リスト>
- visual_assets 登録: 完了
- Discord 通知: 完了
```
