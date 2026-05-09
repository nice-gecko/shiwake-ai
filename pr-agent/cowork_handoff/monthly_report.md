# Cowork 指示書: 月次レポート作成

## あなたの役割

shiwake-ai PR Agent の月次運用レポートを作成する。
Memory Bank（Supabase）から集計し、Markdown レポートを生成する。

---

## 入力（DSKさんから受け取る情報）

| 項目 | 例 |
|------|----|
| 対象月 | 「2026-04」「先月」 |
| 出力形式 | `md`（Markdown）/ `both`（Markdown + Google スプレッドシート） |

---

## 作業手順

### Step 1: データ集計

Supabase から以下を取得・集計する（対象月の範囲: `YYYY-MM-01 00:00:00` ～ `YYYY-MM-31 23:59:59`）。

#### 投稿系

```sql
-- プラットフォーム別投稿数
SELECT platform, COUNT(*) FROM posts
WHERE published_at >= '<月初>' AND published_at < '<翌月初>'
GROUP BY platform;

-- ペルソナ別・キャラ別・構文別
SELECT persona, character_id, weapon, COUNT(*) FROM posts
WHERE published_at >= '<月初>' GROUP BY persona, character_id, weapon;
```

#### エンゲージメント系

```sql
-- 月内総リーチ・いいね・コメント・シェア
SELECT SUM(impressions), SUM(likes), SUM(comments), SUM(shares)
FROM engagements e
JOIN posts p ON p.id = e.post_id
WHERE p.published_at >= '<月初>';

-- エンゲージメント率上位5投稿（24h時点）
SELECT p.content, p.persona, p.character_id, p.weapon, p.trigger_axis,
       (e.likes + e.shares*2 + e.comments*3)::float / NULLIF(e.impressions,0) AS eng_rate
FROM engagements e JOIN posts p ON p.id = e.post_id
WHERE e.elapsed_min = 1440 AND p.published_at >= '<月初>'
ORDER BY eng_rate DESC LIMIT 5;
```

#### 成果系

```sql
-- Panic 発火回数
SELECT COUNT(*) FROM panic_log WHERE triggered_at >= '<月初>';

-- 勝ちパターン上位3
SELECT persona_id, character_id, weapon_id, trigger_id, platform, win_rate, sample_count
FROM success_patterns ORDER BY win_rate DESC LIMIT 3;
```

#### 営業系

```sql
-- 月内追加リード数
SELECT COUNT(*) FROM leads WHERE found_at >= '<月初>';

-- メール送信数・返信率
SELECT COUNT(*) AS sent,
       SUM(CASE WHEN response_received THEN 1 ELSE 0 END) AS replied,
       SUM(CASE WHEN led_to_meeting THEN 1 ELSE 0 END) AS meetings
FROM outreach_history WHERE sent_at >= '<月初>';
```

### Step 2: Markdown レポート生成

出力先: `~/APP/shiwake-ai/pr-agent/dashboard/output/reports/YYYY-MM_monthly_report.md`

```markdown
# shiwake-ai PR Agent 月次レポート（YYYY-MM）

## エグゼクティブサマリー
- 総投稿数: XX件 / 公開: XX件 / 却下: XX件
- 総リーチ: XXX,XXX
- エンゲージメント率（平均）: X.XX%
- 営業: リード XX件 / メール送信 XX件 / 返信 XX件

## 投稿分析
### プラットフォーム別
| プラットフォーム | 投稿数 |
|---|---|
| Threads | XX |
| X（手動） | XX |
...

### 構文別トップ3
...

## エンゲージメント分析
### 上位5投稿（24h エンゲージメント率）
1. [投稿テキスト冒頭30字]... → X.X% （P? × キャラ × W? × トリガー）
...

## 勝ちパターン
### TOP3
1. P? × キャラ × W? × トリガー @platform → 勝率 XX%（XX/XX）
...

### 負けパターン（改善対象）
1. P? × キャラ × W? × トリガー @platform → 勝率 XX%（XX/XX）
...

## 営業実績
- 新規リード: XX件
- メール送信: XX件 / 返信: XX件（返信率 XX%）
- ミーティング獲得: XX件

## 翌月の推奨アクション
（Coworkによる分析）
- ...
- ...
```

### Step 3: Discord 通知

完了時に Discord Webhook（環境変数 `DISCORD_WEBHOOK_URL`）に POST:

```
📊 月次レポート作成完了（YYYY-MM）
- 総投稿数: XX件 / 総リーチ: XXX,XXX
- 営業: リード XX件 / 返信 XX件
- ファイル: dashboard/output/reports/YYYY-MM_monthly_report.md
```

---

## NG 行動

- 数値の捏造（該当データなしの場合は "N/A" と記載）
- 顧客個人情報を含む形でレポートを作らない
- センシティブな個別投稿内容を社外共有可能な形式で出力しない（社内利用前提）

---

## 完了報告フォーマット

```
✅ 月次レポート作成完了
- 対象月: YYYY-MM
- Markdown ファイル: dashboard/output/reports/YYYY-MM_monthly_report.md
- Discord 通知: 完了
```
