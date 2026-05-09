# PR Agent ダッシュボード UI 刷新 引き継ぎ書

## 概要

shiwake-ai PR Agent の管理ダッシュボードを刷新する。
現在は Tailwind CDN + Jinja2 テンプレートのシンプルな実装。
デザインを改善し、使いやすさと見た目を向上させることが目的。

---

## 技術スタック（変更不可）

| 要素 | 内容 |
|------|------|
| バックエンド | FastAPI (Python) + Jinja2 テンプレート |
| CSS | Tailwind CSS（CDN 経由: `https://cdn.tailwindcss.com`） |
| JS | バニラ JS のみ（フレームワークなし） |
| 認証 | HTTP Basic Auth（`DASHBOARD_BASIC_AUTH_USER` / `DASHBOARD_BASIC_AUTH_PASS`） |
| DB | Supabase（バックエンドが処理、テンプレートは表示のみ） |
| サーバー | `uv run uvicorn main:app --port 8765` で起動 |

**制約:**
- Jinja2 テンプレートを編集するだけでよい（バックエンドの変更は原則不要）
- CDN 以外の npm / build step は不可
- 日本語 UI のまま維持

---

## ファイル構成

```
pr-agent/
├── main.py                        # FastAPI エントリポイント
├── dashboard/
│   ├── app.py                     # ルーティング・API（変更不要）
│   └── templates/
│       ├── index.html             # ★ メイン画面（刷新対象）
│       └── post_detail.html       # ★ 投稿詳細画面（刷新対象）
```

---

## 画面構成と機能

### 1. index.html（メイン画面）

**URL:** `GET /dashboard/?view={posts|sales|reports|patterns}`

テンプレート変数（バックエンドから渡される）:

| 変数 | 型 | 内容 |
|------|----|------|
| `view` | str | 現在のビュー名（"posts" / "sales" / "reports" / "patterns"） |
| `status_filter` | str | 投稿ステータスフィルタ（"draft" 等） |
| `status_labels` | dict | ステータスコード → 日本語ラベルの辞書 |

**view=posts 追加変数:**

| 変数 | 型 | 内容 |
|------|----|------|
| `posts` | list[dict] | 投稿一覧（id/platform/persona/character_id/weapon/trigger_axis/status/content/created_at/platform_emoji/status_label） |
| `counts` | dict | ステータス別件数（"draft": N, "all": N, ...） |
| `auto_settings` | dict | プラットフォーム別自動化設定 + 成功率（platform → {auto_publish: bool, rate_info: {rate, success, sample, recommendation}}） |

**view=sales 追加変数:**

| 変数 | 型 | 内容 |
|------|----|------|
| `leads` | list[dict] | リード一覧（company_name/contact_person/specialty[]/size_estimate/priority_score/status/notes） |
| `recent_outreach` | list[dict] | 直近アウトリーチ（sent_at/channel/subject/response_received/led_to_meeting） |
| `sales_stats` | dict | KPI（total_leads/new_leads_month/sent/replied/reply_rate/meetings/signups） |

**view=reports 追加変数:**

| 変数 | 型 | 内容 |
|------|----|------|
| `target_month` | str | 対象月（"YYYY-MM"） |
| `report_content` | str \| None | Markdown テキスト（ない場合 None） |
| `existing_reports` | list[str] | 過去レポートの月リスト（["2026-04", ...]） |

**view=patterns 追加変数:**

| 変数 | 型 | 内容 |
|------|----|------|
| `top_patterns` | list[dict] | 勝ちパターン TOP10（persona_id/character_id/weapon_id/trigger_id/platform/win_rate/sample_count） |
| `lose_patterns` | list[dict] | 改善対象パターン（同上） |

---

### 2. post_detail.html（投稿詳細画面）

**URL:** `GET /dashboard/posts/{post_id}`

テンプレート変数:

| 変数 | 型 | 内容 |
|------|----|------|
| `post` | dict | 投稿データ全フィールド + platform_emoji + status_label |

`post` に含まれる主なフィールド:
- `id`, `platform`, `persona`, `character_id`, `weapon`, `trigger_axis`
- `status`（"draft"/"approved"/"awaiting_manual_post"/"published"/"rejected"）
- `status_label`（日本語ラベル）
- `platform_emoji`（🐦/🧵/📸/📝/👾）
- `content`（投稿本文）
- `scheduled_at`, `published_at`, `external_url`, `manual_posted_url`

**アクション（form の action/method は変更しない）:**

| アクション | method | action |
|-----------|--------|--------|
| 承認 | POST | `/dashboard/posts/{id}/approve` |
| 却下 | POST | `/dashboard/posts/{id}/reject` |

---

## 現在の UI の課題（刷新の動機）

1. **デザインが素朴すぎる** — Tailwind のデフォルトカラーそのまま、個性がない
2. **情報密度が低い** — 投稿カードに余白が多く、一覧性が悪い
3. **タブ切り替えがわかりにくい** — 投稿ビューのサブタブとメインナビが混在
4. **営業ビューがスカスカ** — リードがない場合の空状態 UI が弱い
5. **勝ちパターンが地味** — テーブルだけで視覚的インパクトがない
6. **モバイル最適化が不十分** — 横スクロール発生箇所あり

---

## ブランドガイドライン

**shiwake-ai のブランドカラー:**
- プライマリ: インディゴ（`#4F46E5` / Tailwind `indigo-600`）
- サクセス: グリーン（`#10B981` / Tailwind `emerald-500`）
- 警告: アンバー（`#F59E0B` / Tailwind `amber-500`）
- エラー: レッド（`#EF4444` / Tailwind `red-500`）
- 背景: `#F9FAFB`（Tailwind `gray-50`）

**トーン:** プロフェッショナル・クリーン・日本語 SaaS らしい

---

## API エンドポイント一覧（フォーム送信先）

| 機能 | method | URL |
|------|--------|-----|
| 自動化トグル | POST | `/dashboard/api/automation/{platform}/toggle` |
| note 生成 | POST | `/dashboard/api/note/generate` |
| Zenn 生成 | POST | `/dashboard/api/zenn/generate` ※ body: `topic` |
| リード一覧 (JSON) | GET | `/dashboard/api/sales/leads` |
| 営業 KPI (JSON) | GET | `/dashboard/api/sales/stats` |
| 月次レポート取得 | GET | `/dashboard/api/reports/monthly/{yyyy-mm}` |
| 月次レポート依頼 | POST | `/dashboard/api/reports/monthly` ※ body: `month` |
| Cowork トリガー | POST | `/dashboard/api/cowork/trigger` ※ body: `instruction`, `params[*]` |

**Cowork instruction の選択肢:**
- `lead_finder` — リード探索
- `outreach_writer` — 営業メール下書き
- `monthly_report` — 月次レポート生成
- `image_generate` — Adobe Firefly 画像生成
- `video_generator` — 動画生成

---

## 起動・確認手順

```bash
# サーバー起動
cd ~/APP/shiwake-ai/pr-agent
uv run uvicorn main:app --reload --port 8765

# ブラウザで確認
open http://localhost:8765/dashboard/
# Basic Auth: dsk / rxMFnBS4VA957hiHuZXc3QpZmaK3Vr6s

# 各ビュー
# 投稿: http://localhost:8765/dashboard/?view=posts
# 営業: http://localhost:8765/dashboard/?view=sales
# レポート: http://localhost:8765/dashboard/?view=reports
# 勝ちパターン: http://localhost:8765/dashboard/?view=patterns
# 投稿詳細: http://localhost:8765/dashboard/posts/{post_id}
```

---

## 注意事項

- テンプレート変数名・フォームの `action`/`method`/`name` は**変更しない**（バックエンドと密結合）
- `{% if ... %}` / `{% for ... %}` の Jinja2 制御構文はロジックを変えずに維持
- 追加の JS ライブラリを CDN から読み込む場合は軽量なもの（Alpine.js 等）を推奨
- Chart.js を使う場合は CDN で追加可（グラフ系の可視化に有効）
- 現在の Supabase データが少ない（投稿ゼロ・リードゼロ）ので、空状態の UI も必ず考慮する
