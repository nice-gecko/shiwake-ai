# Cowork 指示書: X エンゲージメント数値の収集

## あなたの役割

X（Twitter）は API 不使用のため Analyst ノードが自動計測できない。
投稿後 30分・3時間・24時間のエンゲージメント数値を X アナリティクスから手動で収集し、
Supabase の `engagements` テーブルに記録する補助をする。

---

## 実行タイミング

- X に手動投稿してから **30分後・3時間後・24時間後** のいずれか
- または DSKさんから「X の数値を記録して」と依頼されたとき

---

## 手順

### Step 1: X アナリティクスから数値を取得

1. [analytics.twitter.com](https://analytics.twitter.com) を開く（または投稿ページの「アナリティクスを見る」）
2. 対象ツイートの以下の数値を確認する:

| 指標 | X での表示名 |
|---|---|
| インプレッション | インプレッション数 |
| いいね | いいね数 |
| 返信 | 返信数 |
| リポスト | リポスト数（RT） |
| クリック | リンクのクリック数（あれば） |

3. 数値をこのチャットに貼り付ける（例: `imp=1200 likes=34 replies=5 rts=8`）

### Step 2: Supabase に記録（DSKさんが実施 or Cowork が SQL を準備）

投稿の `post_id` を確認した上で、以下の SQL を Supabase SQL Editor に貼り付けて実行する:

```sql
INSERT INTO engagements (post_id, elapsed_min, impressions, likes, comments, shares)
VALUES (
  '<post_id>',   -- posts テーブルの id
  <elapsed>,      -- 30 / 180 / 1440
  <impressions>,
  <likes>,
  <replies>,
  <retweets>
);
```

**post_id の調べ方:**
`http://localhost:8000/dashboard/?status_filter=awaiting_manual_post` で対象投稿を開き、
URL の `/posts/{post_id}` から取得する。

### Step 3: バズ判定の確認

以下の閾値を超えていれば DSKさんに報告する（Panic ノード準備のため）:

| タイミング | 閾値 |
|---|---|
| 30分 | いいね ≥ 10、または返信 ≥ 5 |
| 3時間 | いいね ≥ 30、または返信 ≥ 10 |
| 24時間 | いいね ≥ 100、または返信 ≥ 20 |

バズ検知時: 「🔥 バズ検知（30分）: likes=34 が閾値(10)超え」のように報告する。

---

## 注意事項

- X アナリティクスへのアクセスは DSKさんのアカウントが必要。Cowork は数値の整理・SQL 準備を担当。
- 数値が取得できない場合（ツイートが非公開等）はスキップして DSKさんに報告。
- 24時間計測が完了したら、同じ投稿の 30分・3時間データと比較してトレンドをコメントする。
