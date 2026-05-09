# Cowork 指示書: note 記事の代行公開

## あなたの役割

shiwake-ai PR Agent が生成した note 記事の下書きを、note.com に代行投稿する。

---

## 作業手順

### Step 1: 入力ファイルを確認

`~/APP/shiwake-ai/pr-agent/dashboard/output/note_drafts/` 直下の `.md` ファイルを開く。
同名の `.meta.yaml` を読み、タイトル・タグを確認する。
複数ファイルがある場合は `generated_at` が古い順から処理する。

### Step 2: note にログイン（DSKさん本人のアカウント）

https://note.com にアクセスし、DSKさんが既にログイン済みのブラウザを使う。
認証情報（パスワード）の入力は依頼しない。

### Step 3: 新規記事作成

「投稿」ボタン → 「テキスト」を選択する。

| 項目 | 設定値 |
|------|--------|
| タイトル | `meta.yaml` の `title` |
| 本文 | `.md` ファイルの内容（Markdown を note エディタに貼り付け、適宜整形） |
| タグ | `meta.yaml` の `tags` |
| サムネイル | `note_drafts/thumb_*.png` があれば添付、なければ自動生成に任せる |

### Step 4: 公開前チェック（必須）

以下を確認する:
- 競合社名（freee / マネーフォワード / 弥生）が含まれていないか
- 税法の具体数値・条文に根拠リンクが付いているか

問題がある場合は **公開せず** DSKさんに報告する:
「この箇所、ガードレール違反の可能性があります: [該当箇所]」

### Step 5: 公開

「公開」ボタンを押し、公開後の URL を取得する。

### Step 6: Memory Bank 記録

DSKさんに以下を渡す（または Supabase SQL Editor で直接書き込む）:

```sql
UPDATE posts
SET
  status       = 'published',
  external_url = '<公開URL>',
  published_at = now()
WHERE id = '<meta.yaml の post_id>';
```

### Step 7: 下書きを移動

処理済の `.md` と `.meta.yaml` を `dashboard/output/note_drafts/posted/` に移動する。

---

## NG 行動

- DSKさんのパスワード入力を肩代わりしない
- 競合社名を含む記事を、DSKさんの確認なしに公開しない
- 公開済の記事を編集・削除しない（DSKさん本人の判断事項）
- 別のアカウントで投稿しない

---

## 完了報告フォーマット

```
✅ note 公開完了
- タイトル: <title>
- URL: <公開URL>
- 公開時刻: <ISO8601>
- ガードレール: 問題なし / 要確認（理由: ）
```
