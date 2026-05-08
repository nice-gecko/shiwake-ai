# shiwake-ai-PR Agent v2.0 修正パッチ #001
## X（旧Twitter）を手動投稿に変更

> **対象**: `shiwake-ai-PR-Agent_実装指示書_v2.md`
> **適用日**: 2026-05-08
> **理由**: X API Basic プラン（$200/月）のコスト回避。DSKさんが手動投稿。
> **影響**: Phase 1 のタスク削減、環境変数の簡素化、承認ダッシュボードのUI追加

---

## P1-1. 方針サマリー

| 項目 | 変更前 | 変更後 |
|------|-------|-------|
| X API契約 | Basic プラン $200/月 | **不要** |
| Writer の X 原稿生成 | あり | **継続あり**（Phase 2以降の自動化に備える） |
| Publisher の X 配信 | あり | **無し**（Phase 1〜4 すべて） |
| 承認ダッシュボード | 承認/却下 | + **「Xはコピーして手動投稿」UI追加** |
| Analyst の X 計測 | API経由で自動 | **手動入力** or 後回し |

**コアな考え方**: Agent は X 用の「最強の原稿」を作るが、配信責任は人間が持つ。これにより法的リスク・APIコスト・規約変更リスクを全て回避。

---

## P1-2. v2 本体への変更点（セクション別）

### 変更箇所一覧

| セクション | 変更内容 |
|-----------|---------|
| 概要 セクション 5 | 対応SNS表で X の優先度を ★★★ → **★★★（手動）** に |
| Part B B-5 time_table.yaml | X の時間帯は維持（手動投稿の参考時刻として） |
| Part A A-1 posts スキーマ | `status` に `'awaiting_manual_post'` を追加 |
| Part A A-2-5 Publisher | X だけは別経路（投稿せず status を更新するだけ） |
| Part B B-7 T2-1 | **削除**（X API コネクタ実装は不要に） |
| Part C C-1 環境変数 | X関連の環境変数をコメントアウト |
| Part C C-7 申し送り | X は手動運用である旨を追記 |

---

## P1-3. 詳細修正内容

### 修正① Part A A-1 posts テーブル

`status` カラムの取りうる値に `'awaiting_manual_post'` を追加：

```sql
-- 旧: status text not null default 'draft',
--     -- 'draft'|'approved'|'published'|'rejected'
-- 新:
status text not null default 'draft',
-- 'draft' | 'approved' | 'awaiting_manual_post' | 'published' | 'rejected'
-- 'awaiting_manual_post': X専用。承認済みだがDSKさん手動投稿待ち
```

加えて、X 用の手動投稿完了をDSKさんが記録できるよう、以下のカラムを追加：

```sql
alter table posts add column manual_posted_at timestamptz;
alter table posts add column manual_posted_url text;
-- DSKさんが手動投稿完了後にダッシュボードから入力するURL
```

### 修正② Part A A-2-5 Publisher の挙動分岐

```python
class Publisher:
    async def publish(self, post_id: str) -> dict:
        post = await self._load_approved(post_id)
        
        # X だけは手動投稿待ちステータスに変更するだけ
        if post['platform'] == 'x':
            await self._mark_awaiting_manual(post_id)
            return {"status": "awaiting_manual_post"}
        
        # 他のプラットフォームは従来通り自動投稿
        conn = self.conns[post['platform']]
        result = await conn.post(
            content=post['content'],
            media_asset_ids=post['media_asset_ids'],
        )
        await self._mark_published(post_id, result)
        return result

    async def _mark_awaiting_manual(self, post_id: str):
        """status='awaiting_manual_post' に更新するだけ"""
        ...
```

### 修正③ Part B B-7 タスク削除と再番号付け

**削除**: T2-1「X API コネクタ」

**新Phase 1 Week 2タスクリスト**:
- T2-1: ~~X API コネクタ~~ → **削除**
- T2-1（旧T2-2）: Threads API コネクタ
- T2-2（旧T2-3）: Publisher 実装 + 承認連動（X分岐含む）
- T2-3（旧T2-4）: 承認ダッシュボード（**X用コピーUI追加**）
- T2-4（旧T2-5）: LINE/Discord 通知
- T2-5（旧T2-6）: Planner 実装

**Week 2のタスク数**: 6個 → **5個**に減少。Phase 1 の工数が約1日減る。

### 修正④ 承認ダッシュボードのX用UI（旧T2-4 → 新T2-3）

既存の承認ダッシュボードに**X専用ビュー**を追加：

```
┌─────────────────────────────────────────────────┐
│  📋 承認ダッシュボード                          │
│                                                 │
│  ┌─ Threads draft ────────────────────────┐    │
│  │ 「まだ領収書の向きを揃えて...」         │    │
│  │ [✓ 承認] [✗ 却下] [✏️ 修正依頼]         │    │
│  └────────────────────────────────────────┘    │
│                                                 │
│  ┌─ X 手動投稿待ち ───────────────────────┐    │
│  │ 「経理作業の進化論。手入力(原始)→...」 │    │
│  │ [📋 コピー] [🔗 Xを開く]                │    │
│  │ ──────────────────────                  │    │
│  │ 投稿後、URLを貼り付けて完了報告:        │    │
│  │ [_____________________] [完了]          │    │
│  └────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

**実装ポイント**:
- 「📋 コピー」ボタン: クリックで原稿全文をクリップボードにコピー（画像URLも含む場合は画像も別途ダウンロード可）
- 「🔗 Xを開く」ボタン: `https://x.com/intent/post?text=...` を新規タブで開く（Web Intent活用、API不要）
- 完了報告フォーム: DSKさんが投稿後のURLを貼り付けると、`status='published'` + `manual_posted_url` に保存

### 修正⑤ Part C C-1 環境変数

X関連の環境変数をコメントアウト：

```bash
# --- X (Twitter) API --- ※Phase 1〜4 全て手動投稿のため不要
# X_API_KEY=
# X_API_SECRET=
# X_ACCESS_TOKEN=
# X_ACCESS_TOKEN_SECRET=
# X_BEARER_TOKEN=
```

### 修正⑥ Part C C-7 申し送り文の追記

claude code への最初の指示文に1行追加：

```
【X の扱い】
X は API コストを避けるため手動投稿運用です。
Agent は X 用原稿を生成しますが、配信は DSKさんが手動で行います。
T2-1 (X API コネクタ) は実装不要。代わりに承認ダッシュボードに
「X 用コピーUI」を実装してください。
```

---

## P1-4. Web Intent を使った X 投稿の便利化（おまけ）

X は API無しでも、URLパラメータで投稿画面を開ける機能があります。これをダッシュボードに組み込むと、コピペ作業すら省略できます。

### Web Intent URL 仕様

```
https://x.com/intent/post?text=投稿本文&url=リンクURL
```

例:
```
https://x.com/intent/post?text=%E7%B5%8C%E7%90%86%E4%BD%9C%E6%A5%AD%E3%81%AE%E9%80%B2%E5%8C%96%E8%AB%96%E3%80%82%E2%80%A6&url=https%3A%2F%2Fshiwake-ai.com
```

### ダッシュボード実装例（FastAPI + Jinja2）

```html
<!-- dashboard/templates/draft_x.html -->
<div class="x-draft-card">
  <h3>X 手動投稿待ち</h3>
  <div class="content-preview">{{ post.content }}</div>
  
  <button onclick="copyToClipboard()">📋 コピー</button>
  <a href="https://x.com/intent/post?text={{ post.content | urlencode }}" 
     target="_blank">
    🔗 X投稿画面を開く
  </a>
  
  {% if post.media_asset_ids %}
  <div class="media-note">
    ⚠️ 画像 {{ post.media_asset_ids | length }} 枚は別途アップロードしてください
    {% for asset_id in post.media_asset_ids %}
    <a href="{{ get_asset_url(asset_id) }}" download>📥 画像{{loop.index}}</a>
    {% endfor %}
  </div>
  {% endif %}
  
  <form action="/api/x-manual-complete/{{ post.id }}" method="post">
    <label>投稿完了URL:</label>
    <input type="url" name="manual_posted_url" required 
           placeholder="https://x.com/dsk/status/...">
    <button type="submit">完了報告</button>
  </form>
</div>
```

**注意点**:
- 画像付き投稿は Web Intent で**画像を自動添付できない**ため、画像は別タブでダウンロード→Xにドラッグドロップする手間が発生
- テキストのみの投稿なら Web Intent でほぼ1クリック
- スマホでの操作も可能（X アプリが起動する）

---

## P1-5. Analyst の X 計測について

X API 無しでは、インプレッション・いいね数の自動取得もできません。3案あります：

### 案A: 手動入力フォーム（推奨・MVP向け）
ダッシュボードに「24h後の数値を入力する欄」を追加。DSKさんが Xアナリティクスを見て手入力。

```
┌─ X 投稿の24h実績入力 ──────────────────────┐
│ 投稿: 「経理作業の進化論。…」              │
│ 投稿日時: 2026/05/10 12:30                 │
│                                            │
│ インプレッション: [_____]                  │
│ いいね:           [_____]                  │
│ リポスト:         [_____]                  │
│ 返信:             [_____]                  │
│                                            │
│ [保存]                                     │
└────────────────────────────────────────────┘
```

これで **engagements テーブルに記録** → success_patterns の学習が回る。

### 案B: スクレイピング（非推奨）
Playwright で Xアナリティクスにログインして数値取得。利用規約グレー、リスク高。

### 案C: 後回し
Phase 1〜4 では X 計測を完全にスキップ。Threads と Instagram だけで Memory Bank を育てる。

**推奨**: **案A**。手動入力5分で済むし、データの質も高い（DSKさんが目視で異常値を弾ける）。

---

## P1-6. パッチ適用後の Phase 1 検収シナリオ（更新版）

```
[DSKさん操作] python -m main --phase1-run
   ↓
TrendWatcher（最小実装）
GitLogHarvester（直近24h取得、5件翻訳）
   ↓
Planner.plan_today(3) → PostPlan × 3
   ↓
MaterialScout（既存12枚から選ぶだけ）
   ↓
Writer × 3 → posts に draft 3件
   ※ X用 / Threads用 で原稿のトーンが媒体別に違うこと
   ↓
LINE通知「今日の3案できました」+ ダッシュボードURL
   ↓
[DSKさん操作] スマホでダッシュボード開く
   ├─ Threads draft → 1案承認 → 自動配信成功
   └─ X draft → 「コピー」ボタンでクリップボードへ
              → Xアプリで貼り付けて手動投稿
              → 投稿URLをダッシュボードに貼り戻し
              → status='published' + manual_posted_url 保存
   ↓
[DSKさん確認] Threads と X の両方で投稿が見える
[24h後] Threads は自動計測、X は手動入力フォームに記録
```

---

## P1-7. パッチ適用作業（claude code向け）

claude code がこのパッチを v2 本体に反映する手順：

```
1. shiwake-ai-PR-Agent_実装指示書_v2.md と本パッチ（patch_001_x_manual.md）
   の両方を読み込む

2. 修正①〜⑥を v2 本体に適用
   - posts スキーマの修正は memory/schema.sql に反映
   - Publisher の分岐ロジックは brain/publisher.py に反映
   - 環境変数のコメントアウトは .env.example に反映
   - Phase 1 タスクの再番号付けはタスクトラッカーに反映

3. 適用後、v2.1 として保存（v2.0は履歴として残す）

4. DSKさんに「パッチ適用完了、Phase 1 タスク数が6→5になりました」と報告
```

ただし**今すぐの適用は不要**。実装着手時に2ファイルを並行参照すればOK。

---

# 修正パッチ #001 ここまで。
# 次はデモアカウント整備のフル手順書を別ファイルで作成。
