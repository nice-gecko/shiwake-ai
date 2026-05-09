# Cowork 指示書: Adobe MCP 短尺動画生成（リール / Threads 動画）

## あなたの役割

shiwake-ai の SNS マーケティング用の短尺動画（15〜60秒）を Adobe MCP 経由で生成し、
Instagram リール または Threads 動画として活用できる素材を用意する。

---

## 入力（DSKさんから受け取る情報）

| 項目 | 例 |
|------|----|
| コンセプト | 「仕訳の苦労 → shiwake-ai で解放」「経理スタッフがギフト券をもらう瞬間」 |
| ターゲット | P1（個人）/ P2（スタッフ）/ P3（経営者）/ P4（税理士）|
| 尺 | 15秒 / 30秒 / 60秒 |
| フォーマット | reels（9:16縦型）/ threads（1:1正方形） |

---

## 作業手順

### Step 1: Adobe MCP で素材準備

Adobe MCP の以下のツールを使って素材を用意する:

**画像ベースの動画（推奨）:**
1. `adobe_mandatory_init` で初期化
2. `asset_search` でシーンに合う素材を検索
3. `image_remove_background` で人物などを切り抜き
4. `image_generative_expand` でキャンバスを動画サイズに拡張
5. `change_background_color` でブランドカラー背景を設定

**カット動画の作成:**
6. `video_create_quick_cut` で複数画像をシーケンスに組む

---

### Step 2: ナレーション / テキストオーバーレイ

Adobe MCP の `fill_text` でテキスト要素を追加:
- オープニングテキスト（問題提起）: 3秒
- 中盤テキスト（解決策）: 10秒
- クロージングテキスト（CTA）: 2秒

**テキストガイドライン:**
- フォント: 太字、可読性重視
- 背景: 半透明グレー or ブランドカラー（インディゴ系）
- 競合社名は含めない

---

### Step 3: 動画出力

`download_design` または `video_resize` でフォーマット別に書き出し:

| フォーマット | 解像度 | FPS |
|------------|--------|-----|
| reels      | 1080×1920 (9:16) | 30fps |
| threads    | 1080×1080 (1:1)  | 30fps |

---

### Step 4: 保存

- ローカル: `~/APP/shiwake-ai/pr-agent/dashboard/output/video_drafts/`
- ファイル名: `video_{persona_id}_{concept_slug}_{YYYY-MM-DD}.mp4`
- Supabase Storage に任意でアップロード（バケット: `visuals-bucket/videos/`）

---

### Step 5: visual_assets への登録（静止画サムネイル）

動画のサムネイル画像を `visual_assets` テーブルに INSERT:

```sql
INSERT INTO visual_assets (
  storage_path, source, category, tags,
  weapon_compatibility, persona_fit, description,
  has_pii, masking_required
) VALUES (
  'videos/<persona_id>/<filename_thumbnail>.jpg',
  'generated', 'video_thumbnail',
  ARRAY['video', 'reels', '<persona_id>'],
  ARRAY['W1', 'W4'],
  ARRAY['<persona_id>'],
  '動画サムネイル: <コンセプト>',
  false, false
);
```

---

### Step 6: Discord 通知

```
🎬 動画生成完了
- コンセプト: <コンセプト>
- ターゲット: <persona_id>
- フォーマット: <reels/threads> (<尺>秒)
- ファイル: video_drafts/<ファイル名>.mp4
- DSKさんレビュー後に Instagram / Threads へアップロード
```

---

## NG 行動

| NG | 理由 |
|----|------|
| ❌ 実在の人物の顔が映る動画 | プライバシー・肖像権リスク |
| ❌ 音楽の無断使用 | 著作権リスク（Adobe Stock 楽曲のみ使用） |
| ❌ 競合ロゴ・ブランド名の使用 | ブランドリスク |
| ❌ DSKさんレビューなしで投稿 | コンテンツ品質・ブランドリスク |

---

## 完了報告フォーマット

```
✅ 動画生成完了
- コンセプト: <コンセプト>
- 生成ファイル: <ファイル名>
- 保存先: dashboard/output/video_drafts/
- Discord 通知: 完了
- DSKさんレビュー待ち
```
