# shiwake-ai-PR Agent 実装指示書 v2.0 - Part C
## 環境変数 + デプロイ + claude code 申し送り決定版

> Part C は v2 の **運用開始に必要な実務手順**を定義する。
> Part A（データ基盤）+ Part B（設定とPhase 1基準）に依存。
> 作成: 2026-05-08

---

## C-1. 環境変数（.env.example）

```bash
# ============================================================
# shiwake-ai-PR Agent  Environment Variables
# ============================================================

# --- Anthropic ---
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL_DEFAULT=claude-sonnet-4-6
ANTHROPIC_MODEL_HEAVY=claude-opus-4-7        # Plannerの戦略決定など重要判断のみ

# --- Supabase ---
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...              # サーバー側専用、絶対に公開しない
SUPABASE_ANON_KEY=eyJ...                      # ダッシュボードのフロントから使う場合のみ
SUPABASE_STORAGE_BUCKET=visuals-bucket

# --- GitHub（Gitログ素材化用）---
GITHUB_TOKEN=ghp_...                          # nice-gecko/shiwake-ai のリポジトリ読み取り権限
GITHUB_REPO=nice-gecko/shiwake-ai

# --- X (Twitter) API ---
X_API_KEY=
X_API_SECRET=
X_ACCESS_TOKEN=
X_ACCESS_TOKEN_SECRET=
X_BEARER_TOKEN=

# --- Meta (Threads + Instagram) ---
META_APP_ID=
META_APP_SECRET=
THREADS_USER_ID=
THREADS_ACCESS_TOKEN=
IG_BUSINESS_ACCOUNT_ID=
IG_ACCESS_TOKEN=

# --- 通知（どちらか一方）---
LINE_NOTIFY_TOKEN=                            # LINE Notify を選んだ場合
DISCORD_WEBHOOK_URL=                          # Discord を選んだ場合

# --- shiwake-ai 本体との連携 ---
SHIWAKE_AI_WEBHOOK_SECRET=                    # 本体 → PR Agent への通知の署名検証用
SHIWAKE_AI_DEMO_USER_EMAIL=demo@shiwake-ai.com
SHIWAKE_AI_DEMO_USER_PASSWORD=                # Playwright撮影用、Cloud Run Secret Manager 推奨

# --- 画像生成（Phase 2以降）---
IMAGE_GEN_PROVIDER=anthropic                  # 将来的に切替可能に
# 必要に応じて他プロバイダのキーを追加

# --- 承認ダッシュボード ---
DASHBOARD_BASE_URL=https://pr-agent-xxxxx.run.app
DASHBOARD_BASIC_AUTH_USER=dsk
DASHBOARD_BASIC_AUTH_PASS=                    # ダッシュボードを保護する簡易Basic認証

# --- 運用 ---
LOG_LEVEL=INFO
TIMEZONE=Asia/Tokyo
```

### 環境変数の保管方針

- **ローカル開発**: `.env` ファイル（gitignore必須）
- **Cloud Run 本番**: Google Cloud **Secret Manager** に格納し、Cloud Run のサービスから参照
- **絶対にコミットしない変数**: `ANTHROPIC_API_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`SHIWAKE_AI_DEMO_USER_PASSWORD`、各SNSのトークン

---

## C-2. デプロイ構成（Cloud Run + Cloud Scheduler）

### 全体図

```
┌─────────────────────────────────────────────────────────┐
│  Google Cloud                                           │
│                                                         │
│  ┌──────────────────────┐                              │
│  │  Cloud Run           │ ← HTTPSエンドポイント         │
│  │  pr-agent サービス   │                              │
│  │  (FastAPI + Agent)   │                              │
│  └──────────┬───────────┘                              │
│             │                                           │
│  ┌──────────▼───────────┐   ┌────────────────────┐     │
│  │  Cloud Scheduler     │──▶│  /api/cron/...     │     │
│  │  毎朝 8:30 / 9:00    │   │  各エンドポイント   │     │
│  │  +30min/3h/24h       │   └────────────────────┘     │
│  └──────────────────────┘                              │
│                                                         │
│  ┌──────────────────────┐                              │
│  │  Secret Manager      │                              │
│  │  (API keys, tokens)  │                              │
│  └──────────────────────┘                              │
└─────────────────────────────────────────────────────────┘
                  │
                  │ 接続
        ┌─────────▼──────────┐
        │  Supabase          │
        │  (DB + Storage)    │
        └────────────────────┘
                  │
                  │ Webhook
        ┌─────────▼──────────┐
        │  Render            │
        │  shiwake-ai 本体   │
        │  (インセンティブ通知)│
        └────────────────────┘
```

### C-2-1. Dockerfile

```dockerfile
# pr-agent/Dockerfile
FROM python:3.12-slim

# Playwright のために必要
RUN apt-get update && apt-get install -y \
    wget gnupg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 依存関係インストール
COPY pyproject.toml poetry.lock* ./
RUN pip install --no-cache-dir poetry && \
    poetry config virtualenvs.create false && \
    poetry install --no-dev --no-interaction --no-ansi

# Playwright のブラウザバイナリ
RUN playwright install chromium --with-deps

# アプリコード
COPY . .

# Cloud Run はデフォルトで PORT 環境変数を渡してくる
ENV PORT=8080
EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
```

### C-2-2. Cloud Run デプロイコマンド

```bash
# 初回デプロイ
gcloud run deploy pr-agent \
  --source . \
  --region asia-northeast1 \
  --platform managed \
  --memory 1Gi \
  --cpu 1 \
  --timeout 600 \
  --concurrency 10 \
  --min-instances 0 \
  --max-instances 3 \
  --set-secrets="ANTHROPIC_API_KEY=anthropic-key:latest,SUPABASE_SERVICE_ROLE_KEY=supabase-key:latest" \
  --set-env-vars="TIMEZONE=Asia/Tokyo,LOG_LEVEL=INFO" \
  --allow-unauthenticated

# 確認
gcloud run services describe pr-agent --region asia-northeast1 --format="value(status.url)"
```

### C-2-3. Cloud Scheduler ジョブ

```bash
# 毎朝 8:30 - TrendWatcher + GitLogHarvester
gcloud scheduler jobs create http pr-agent-morning-scout \
  --schedule="30 8 * * *" \
  --time-zone="Asia/Tokyo" \
  --uri="https://pr-agent-xxxxx.run.app/api/cron/scout" \
  --http-method=POST \
  --oidc-service-account-email=scheduler@PROJECT.iam.gserviceaccount.com \
  --location=asia-northeast1

# 毎朝 9:00 - Planner（3案生成 + LINE通知）
gcloud scheduler jobs create http pr-agent-morning-plan \
  --schedule="0 9 * * *" \
  --time-zone="Asia/Tokyo" \
  --uri="https://pr-agent-xxxxx.run.app/api/cron/plan" \
  --http-method=POST \
  --location=asia-northeast1

# 5分ごと - Analyst（投稿後30min/3h/24hの計測スケジュール監視）
gcloud scheduler jobs create http pr-agent-analyst \
  --schedule="*/5 * * * *" \
  --time-zone="Asia/Tokyo" \
  --uri="https://pr-agent-xxxxx.run.app/api/cron/analyze" \
  --http-method=POST \
  --location=asia-northeast1
```

### C-2-4. main.py エンドポイント構成

```python
# main.py（FastAPI）
from fastapi import FastAPI

app = FastAPI(title="shiwake-ai-PR Agent")

# === ヘルスチェック ===
@app.get("/")
async def health():
    return {"status": "ok", "version": "v2.0"}

# === Cron エンドポイント（Cloud Schedulerから叩かれる）===
@app.post("/api/cron/scout")
async def cron_scout():
    """毎朝 8:30 - TrendWatcher + GitLogHarvester"""
    ...

@app.post("/api/cron/plan")
async def cron_plan():
    """毎朝 9:00 - Planner.plan_today(3) → Writer → 通知"""
    ...

@app.post("/api/cron/analyze")
async def cron_analyze():
    """5分ごと - 計測対象のpostがあればAnalystを起動"""
    ...

# === 承認ダッシュボード関連 ===
@app.get("/dashboard")
async def dashboard():
    """draft一覧表示"""
    ...

@app.post("/api/approve/{post_id}")
async def approve(post_id: str):
    """承認 → Publisher起動"""
    ...

@app.post("/api/reject/{post_id}")
async def reject(post_id: str): ...

# === shiwake-ai 本体からのWebhook ===
@app.post("/api/webhook/incentive")
async def webhook_incentive(request: Request):
    """shiwake-ai本体でインセンティブイベント発生時に呼ばれる"""
    # SHIWAKE_AI_WEBHOOK_SECRET で署名検証必須
    ...
```

---

## C-3. shiwake-ai 本体との連携（インセンティブ Webhook）

Gemini採用E「インセンティブ連動」の実装ポイント。

### C-3-1. shiwake-ai 本体側に追加するWebhook送信コード

`~/APP/shiwake-ai/server.js` に追加するイメージ（Node.js）：

```javascript
// shiwake-ai/server.js（既存ファイルへの追加）
const crypto = require('crypto');

const PR_AGENT_WEBHOOK_URL = process.env.PR_AGENT_WEBHOOK_URL;
const PR_AGENT_WEBHOOK_SECRET = process.env.PR_AGENT_WEBHOOK_SECRET;

async function notifyPRAgent(eventType, payload) {
  if (!PR_AGENT_WEBHOOK_URL) return; // PR Agent 未稼働なら無視

  const body = JSON.stringify({
    event_type: eventType,        // 'milestone_reached'|'staff_top'|'amazon_gift_sent'
    occurred_at: new Date().toISOString(),
    payload,
  });
  const signature = crypto
    .createHmac('sha256', PR_AGENT_WEBHOOK_SECRET)
    .update(body)
    .digest('hex');

  try {
    await fetch(`${PR_AGENT_WEBHOOK_URL}/api/webhook/incentive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': signature,
      },
      body,
    });
  } catch (err) {
    console.error('PR Agent notify failed:', err);
    // PR Agent障害が本体に影響しないよう、失敗は飲む
  }
}

// 使用例: インセンティブ達成時
async function onIncentiveMilestone(user) {
  // 既存のSendGrid通知処理 ...
  
  // PR Agent への通知（追加）
  await notifyPRAgent('milestone_reached', {
    display_name: user.display_name || 'スタッフAさん',  // 公開してもOKな名前
    count_value: user.incentive_total,
  });
}
```

### C-3-2. PR Agent側のWebhook受信

```python
# pr-agent/main.py の webhook_incentive エンドポイント詳細
import hmac
import hashlib
import os
from fastapi import HTTPException, Request

@app.post("/api/webhook/incentive")
async def webhook_incentive(request: Request):
    body = await request.body()
    signature = request.headers.get("X-Signature", "")

    # 署名検証
    expected = hmac.new(
        os.environ["SHIWAKE_AI_WEBHOOK_SECRET"].encode(),
        body,
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(401, "Invalid signature")

    payload = await request.json()
    # incentive_events テーブルにinsert（consumed=false）
    await store_incentive_event(payload)
    return {"status": "received"}
```

### C-3-3. shiwake-ai 本体側の環境変数（Render）

`~/APP/shiwake-ai` のRender環境変数に追加：

```
PR_AGENT_WEBHOOK_URL=https://pr-agent-xxxxx.run.app
PR_AGENT_WEBHOOK_SECRET=（PR Agent側と同じ値）
```

---

## C-4. プロジェクト初期化コマンド集

claude code が最初に叩く想定。

```bash
# 0. 移動
cd ~/APP/shiwake-ai

# 1. PR Agent ディレクトリ作成
mkdir -p pr-agent && cd pr-agent

# 2. Python プロジェクト初期化
poetry init --no-interaction \
  --name pr-agent \
  --description "shiwake-ai PR Agent" \
  --python "^3.12"

# 3. 依存関係追加
poetry add \
  fastapi \
  uvicorn[standard] \
  supabase \
  anthropic \
  pyyaml \
  pydantic \
  pydantic-settings \
  httpx \
  pillow \
  playwright \
  python-multipart \
  jinja2

poetry add --group dev \
  pytest \
  pytest-asyncio \
  ruff

# 4. Playwright ブラウザ
poetry run playwright install chromium

# 5. ディレクトリ構造作成
mkdir -p brain/personalities brain/weapons brain/triggers
mkdir -p connectors visuals/raw memory notify sales dashboard config

# 6. .gitignore 設定
cat > .gitignore <<'EOF'
.env
__pycache__/
*.pyc
.venv/
.pytest_cache/
visuals/raw/auto/   # Playwright撮影結果はコミットしない
EOF

# 7. 動作確認
poetry run uvicorn main:app --reload
```

---

## C-5. Phase 2-4 の概要（参考）

Phase 1 完了後に詳細を再協議する前提のラフスケッチ。

### Phase 2 (Week 3): Instagram + Analyst強化 + MaterialScout

- Instagram Graph API 連携（画像必須なので Pillow 加工パイプライン整備）
- Analyst の30min/3h/24h スケジューラ完成
- MaterialScout の在庫検索→生成フローを稼働
- visual_assets に「自動撮影」枠を追加（Playwrightで本番のデモアカウントから毎朝撮影）

### Phase 3 (Week 4): note + Panic + 自動化解禁

- note の Playwright 自動投稿（規約再確認）
- Panic ノードの2段構え稼働（セルフリプライ + 続報）
- success_patterns のスコアが閾値を超えた構文/媒体から段階的に自動化解禁
- TrendWatcher の本格稼働

### Phase 4 (Week 5): Zenn + 営業ツール + ダッシュボード強化

- Zenn の GitHub経由記事更新
- `sales/lead_finder.py`: Google Maps API or 税理士会名簿から税理士事務所リスト取得
- `sales/outreach_writer.py`: Memory Bankの勝ちパターンを引用したパーソナライズメール生成
- ダッシュボードに分析ビュー追加（どの構文/キャラ/ペルソナの組み合わせが勝っているか）

---

## C-6. リスクとモニタリング

### 想定リスクと対策

| リスク | 影響 | 対策 |
|-------|-----|-----|
| LLMの出力に競合社名が混入 | リーガル | Writer出力後に正規表現でチェック、検出時は再生成 |
| パニックモード暴走 | ブランド毀損 | 続報投稿は必ず追加承認制 |
| Playwright投稿（note）の規約違反 | アカBAN | Phase 3 着手前に最新規約を再確認、人間レビュー必須 |
| API料金の予期せぬ高騰 | コスト | 月次予算アラート（Anthropic / Cloud Run / Supabase 各々） |
| インセンティブWebhookの誤発火 | 誤った祝福投稿 | webhook受信時の署名検証 + draft段階でDSKさん承認 |
| デモアカウントへの本番ユーザー混入 | データ汚染 | `is_demo=true` フラグで本体の統計から除外 |

### 必須モニタリング項目

- Cloud Run のエラー率（5xx）
- Supabase の接続数・容量
- Anthropic API のトークン消費量（日次）
- 各SNS の投稿成功率
- 承認待ち draft の滞留数（24h超で警告）

---

## C-7. claude code への申し送り（最終版）

DSKさんが claude code に最初に渡す指示文の決定版。

### 渡し方

1. v2 完成版（A+B+C 統合ファイル）を `~/APP/shiwake-ai/pr-agent_実装指示書_v2.md` に保存
2. claude code を `~/APP/shiwake-ai` で起動
3. 以下のメッセージを最初に送る

### 申し送り文（コピペ用）

```
@claude code

これから shiwake-ai-PR Agent を開発します。

【最重要ルール】
1. トークン節約: 大規模な変更・新規ファイル作成の前に必ず私（DSK）に承認を取ってください。
   「これから○○を作ります、よろしいですか？」のひと声を入れる。
2. 5回セルフチェック: コミット前に間違い・漏れ・矛盾を最低5回確認してから push。
3. デプロイの作法: cd ~/APP/shiwake-ai/pr-agent の後、ディレクトリ移動を挟まず
   git add → commit → push を1ブロックで出してください。
4. 設計思想の継承: shiwake-ai 本体の「判断の見える化」をPR Agent側にも適用。
   AgentがなぜこのキャラとW3を選んだか、私本人にも見える形で残してください。

【参照ドキュメント】
~/APP/shiwake-ai/pr-agent_実装指示書_v2.md

【最初のタスク】
Part C のセクション C-4「プロジェクト初期化コマンド集」を順に実行してください。
ただし、各ステップ着手前に「これから○○を実行します」と私に確認してください。

【不明点】
仕様や設計の判断で迷ったら Claude chat（指示出し役）に相談してOK。
コードの実装方法は claude code が判断してください。

準備ができたら「Phase 1 T1-1 を始めます」と宣言してから着手してください。
```

---

## C-8. Part C の完了基準

claude code が Part C を実装し終えた状態：

- [ ] `.env.example` がリポジトリに配置、`.env` がgitignoreで除外
- [ ] Dockerfile が動作、ローカルで `docker build && docker run` で起動できる
- [ ] Cloud Run にデプロイ済み、ヘルスチェック `/` が `{"status":"ok"}` を返す
- [ ] Cloud Scheduler ジョブ3本登録済み（scout / plan / analyze）
- [ ] shiwake-ai 本体（Render）に Webhook送信コードが追加され、PR_AGENT_WEBHOOK_URL/SECRET が設定済み
- [ ] PR Agent側で `/api/webhook/incentive` が署名検証込みで動作
- [ ] DSKさんが手動で本体のインセンティブイベントをトリガー → PR Agent の incentive_events に記録される動作確認済み

---

# Part C ここまで。
# A + B + C を統合した v2 完成版を次に出力する。
