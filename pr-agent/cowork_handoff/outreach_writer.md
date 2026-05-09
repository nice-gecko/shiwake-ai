# Cowork 指示書: カスタマイズ営業メール下書き

## あなたの役割

leads テーブルから営業対象のリードを選択し、
各リードにカスタマイズした営業メール下書きを作成する。
**DSKさんのレビューなしで送信しない。草稿のみ作成。**

---

## 入力（DSKさんから受け取る情報）

| 項目 | 例 |
|------|----|
| 対象 | lead_id 一覧 / 「直近追加されたリード」/ 「priority 4-5 のみ」 |
| メールトーン | `formal`（かしこまった）/ `friendly`（親しみのある）/ `professional`（プロ） |
| CTA | `demo`（デモ依頼）/ `meeting`（打ち合わせ）/ `trial`（無料試用） |

---

## 作業手順

### Step 1: 対象リードの取得

Supabase の leads テーブルから対象リードを SELECT し、以下を確認:
- `company_name`（事務所名）
- `contact_person`（代表名、あれば）
- `specialty`（専門分野）
- `notes`（リード探索時に記録した特徴）
- `digital_savvy_score`（導入素地）

### Step 2: メール下書き作成

**フォーマット（1リード = 1メール、必ずカスタマイズ）:**

```
件名: [事務所名]様 - 仕訳業務の効率化につきまして（shiwake-ai）

[事務所名] [代表名]様

突然のご連絡失礼いたします。
合同会社和泉グミ代表の和泉と申します。

御社の HP にて、[notes から拾った具体的な特徴] を拝見しました。
[特徴に対するコメント、なぜ shiwake-ai が貴所にフィットすると考えるか]

弊社では、AI を活用した仕訳補助ツール「shiwake-ai」を提供しており、
税理士事務所様向けには以下のメリットがあります:

・[specialty に応じた具体的なベネフィット 1]
・[specialty に応じた具体的なベネフィット 2]
・[digital_savvy_score が低い場合は「導入の手軽さ」、高い場合は「機能の専門性」を強調]

無料デモのご案内をさせていただきたく、
ご都合の良い日時をいくつか教えていただけますでしょうか。

shiwake-ai 詳細: https://shiwake-ai.com

何卒よろしくお願いいたします。

合同会社和泉グミ
代表 和泉大介
support@shiwake-ai.com
```

### Step 3: カスタマイズの肝

- **必ず 1リードに 1メールをカスタマイズ**（コピペ・テンプレ流用は禁止）
- `notes` に書かれた特徴を少なくとも1つは引用する
- `specialty` に応じたベネフィットを 2-3 個列挙
- `digital_savvy_score` が低い場合 → 「導入の手軽さ・サポートの充実」を強調
- `digital_savvy_score` が高い場合 → 「機能の専門性・API 連携・カスタマイズ性」を強調

### Step 4: ガードレール（必須チェック）

以下を含むメールは送らない・修正する:

| NG | 理由 |
|----|------|
| ❌ 競合社名（freee / マネーフォワード / 弥生） | ブランドリスク |
| ❌ 税法の数値・条文の断定 | 法的リスク（根拠リンク必須） |
| ❌ 誇大表現（「絶対に儲かる」「100%失敗しない」） | 景表法リスク |
| ❌ 機密情報・個人情報 | プライバシーリスク |

### Step 5: 出力

各メールを以下の形式で保存:

- ローカル: `~/APP/shiwake-ai/pr-agent/dashboard/output/outreach/draft_[lead_id]_[YYYY-MM-DD].md`

```markdown
---
lead_id: <UUID>
company_name: <事務所名>
contact_email: <メールアドレス>
channel: email
generated_at: <ISO8601>
---

件名: ...

本文:
...
```

### Step 6: DSKさんレビュー後の記録

DSKさんがレビューし送信した分について、Supabase の `outreach_history` に INSERT:

```sql
INSERT INTO outreach_history (lead_id, channel, subject, body, template_used, sent_by)
VALUES ('<lead_id>', 'email', '<件名>', '<本文>', 'custom_v1', 'dsk');
```

---

## NG 行動

- DSKさんのレビューなしで送信しない（草稿のみ作成）
- ガードレール違反があれば DSKさんに警告してから止まる
- 同じ文面を複数リードに送らない（必ずカスタマイズ）

---

## 完了報告フォーマット

```
✅ メール下書き作成完了
- 対象件数: <件数>件
- ガードレール違反検知: <件数>件（あれば詳細を報告）
- 草稿保存先: ~/APP/shiwake-ai/pr-agent/dashboard/output/outreach/
- DSKさんレビュー待ち
```
