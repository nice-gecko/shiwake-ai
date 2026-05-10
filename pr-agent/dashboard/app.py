"""
承認ダッシュボード

Routes:
  GET  /dashboard/          — ダッシュボード (view=posts/sales/reports/patterns)
  GET  /dashboard/posts/{id} — 投稿詳細 + 承認 / 却下 / X コピー UI
  POST /dashboard/posts/{id}/approve — 承認 → Publisher 呼び出し
  POST /dashboard/posts/{id}/reject  — 却下
  GET  /dashboard/api/sales/leads    — リード一覧 (JSON)
  POST /dashboard/api/sales/leads    — リード追加 (JSON)
  PATCH /dashboard/api/sales/leads/{id} — リードステータス更新 (JSON)
  GET  /dashboard/api/sales/stats    — 営業 KPI 集計 (JSON)
  GET  /dashboard/api/reports/monthly/{yyyy_mm} — 月次レポート取得
  POST /dashboard/api/reports/monthly — 月次レポート生成依頼
  POST /dashboard/api/cowork/trigger — Cowork 実行依頼

Basic Auth: DASHBOARD_BASIC_AUTH_USER / DASHBOARD_BASIC_AUTH_PASS
"""

import json
import os
import secrets
from dotenv import set_key as _dotenv_set_key
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.templating import Jinja2Templates
from supabase import create_client, Client

import yaml

from brain.analytics import SuccessRateCalculator
from brain.pipeline import Pipeline
from brain.planner import PlannerInput

load_dotenv()

router    = APIRouter(prefix="/dashboard")
security  = HTTPBasic()
templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))

_PLATFORM_EMOJI = {"x": "🐦", "threads": "🧵", "instagram": "📸", "note": "📝", "zenn": "👾"}

# ============================================================
# キャラクター名オーバーライド
# ============================================================

_CHAR_EMOJI = {
    "shoyo_kun": "🧑‍💼", "shoyo_chan": "👧", "zeirishi_sensei": "👨‍🏫",
    "keiri_san": "👩‍💻", "shacho": "🧔",
}
_CHAR_NAMES_DEFAULTS = {
    "shoyo_kun": "しょうよ君", "shoyo_chan": "しょうよちゃん", "zeirishi_sensei": "税理士先生",
    "keiri_san": "経理さん", "shacho": "社長",
}
_CHAR_NAMES_PATH = Path(__file__).parent.parent / "config" / "character_name_overrides.json"
_ENV_PATH        = Path(__file__).parent.parent / ".env"
_CHAR_NAMES_STORAGE_KEY = "config/character_name_overrides.json"


def _get_supabase_optional() -> "Client | None":
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        return None
    try:
        return create_client(url, key)
    except Exception:
        return None


def _load_char_names() -> dict:
    names = dict(_CHAR_NAMES_DEFAULTS)
    # 1. ローカルファイル優先（ローカル開発用）
    try:
        if _CHAR_NAMES_PATH.exists():
            names.update(json.loads(_CHAR_NAMES_PATH.read_text(encoding="utf-8")))
            return names
    except Exception:
        pass
    # 2. Supabase Storage にフォールバック（Render などエフェメラル環境）
    try:
        sb = _get_supabase_optional()
        bucket = os.getenv("SUPABASE_STORAGE_BUCKET", "visuals-bucket")
        if sb:
            data = sb.storage.from_(bucket).download(_CHAR_NAMES_STORAGE_KEY)
            names.update(json.loads(data.decode("utf-8")))
    except Exception:
        pass
    return names


def _save_char_names(names: dict) -> None:
    payload = json.dumps(names, ensure_ascii=False, indent=2)
    # ローカルファイルに保存
    try:
        _CHAR_NAMES_PATH.parent.mkdir(parents=True, exist_ok=True)
        _CHAR_NAMES_PATH.write_text(payload, encoding="utf-8")
    except Exception:
        pass
    # Supabase Storage にもアップロード（Render 再起動後も永続化）
    try:
        sb = _get_supabase_optional()
        bucket = os.getenv("SUPABASE_STORAGE_BUCKET", "visuals-bucket")
        if sb:
            data = payload.encode("utf-8")
            try:
                sb.storage.from_(bucket).upload(
                    _CHAR_NAMES_STORAGE_KEY, data,
                    {"content-type": "application/json", "upsert": "true"},
                )
            except Exception:
                sb.storage.from_(bucket).update(
                    _CHAR_NAMES_STORAGE_KEY, data,
                    {"content-type": "application/json"},
                )
    except Exception:
        pass


# Jinja2 グローバルとして設定（マクロからも参照可能）
templates.env.globals["_char_names"] = _load_char_names()
_STATUS_LABEL   = {
    "draft":                "下書き",
    "approved":             "承認済",
    "awaiting_manual_post": "手動投稿待ち",
    "published":            "投稿済",
    "rejected":             "却下",
}


# ============================================================
# Basic Auth
# ============================================================

def _auth(credentials: HTTPBasicCredentials = Depends(security)) -> str:
    user = os.getenv("DASHBOARD_BASIC_AUTH_USER", "dsk")
    pwd  = os.getenv("DASHBOARD_BASIC_AUTH_PASS", "")

    ok = (
        secrets.compare_digest(credentials.username.encode(), user.encode())
        and secrets.compare_digest(credentials.password.encode(), pwd.encode())
    )
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="認証失敗",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username


# ============================================================
# Supabase クライアント（リクエストごとに使い回す）
# ============================================================

def _db() -> Client:
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise HTTPException(500, "Supabase 環境変数未設定")
    return create_client(url, key)


# ============================================================
# ヘルパー
# ============================================================

def _enrich(post: dict) -> dict:
    """テンプレート用に絵文字・ラベルを付与する"""
    post["platform_emoji"] = _PLATFORM_EMOJI.get(post.get("platform", ""), "📣")
    post["status_label"]   = _STATUS_LABEL.get(post.get("status", ""), post.get("status", ""))
    return post


# ============================================================
# Routes
# ============================================================

@router.get("/", response_class=HTMLResponse)
async def index(
    request: Request,
    status_filter: str = "draft",
    view: str = "posts",
    month: str = "",
    _user: str = Depends(_auth),
) -> HTMLResponse:
    db = _db()
    ctx: dict = {"view": view, "status_filter": status_filter, "status_labels": _STATUS_LABEL, "settings_data": None}

    # ============ 投稿ビュー ============
    if view in ("posts", ""):
        query = db.table("posts").select(
            "id, platform, persona, character_id, weapon, trigger_axis, status, "
            "content, scheduled_at, published_at, external_url, created_at"
        ).order("created_at", desc=True)

        if status_filter != "all":
            query = query.eq("status", status_filter)

        rows = query.limit(50).execute()
        ctx["posts"] = [_enrich(p) for p in (rows.data or [])]

        counts_raw = db.table("posts").select("status").execute()
        counts: dict[str, int] = {}
        for r in counts_raw.data or []:
            s = r["status"]
            counts[s] = counts.get(s, 0) + 1
        counts["all"] = sum(counts.values())
        ctx["counts"] = counts

        auto_settings: dict[str, dict] = {}
        try:
            auto_rows = db.table("automation_settings").select("*").execute()
            calc = SuccessRateCalculator()
            for row in (auto_rows.data or []):
                pf = row["platform"]
                auto_settings[pf] = {**row, "rate_info": calc.calc(pf)}
        except Exception:
            pass
        ctx["auto_settings"] = auto_settings

    # ============ 営業ビュー ============
    elif view == "sales":
        leads = db.table("leads").select("*").order("priority_score", desc=True).limit(100).execute().data or []
        ctx["leads"] = leads
        # 直近アウトリーチ
        recent_outreach = db.table("outreach_history").select(
            "id, lead_id, sent_at, channel, subject, response_received, led_to_meeting, led_to_signup"
        ).order("sent_at", desc=True).limit(20).execute().data or []
        ctx["recent_outreach"] = recent_outreach
        # KPI
        ctx["sales_stats"] = _calc_sales_stats(db)

    # ============ レポートビュー ============
    elif view == "reports":
        now_jst = datetime.now(_JST)
        target_month = month or now_jst.strftime("%Y-%m")
        ctx["target_month"] = target_month

        report_path = _REPORTS_DIR / f"{target_month}_monthly_report.md"
        ctx["report_content"] = report_path.read_text(encoding="utf-8") if report_path.exists() else None

        # 既存レポートファイル一覧
        existing = sorted(_REPORTS_DIR.glob("*_monthly_report.md"), reverse=True)
        ctx["existing_reports"] = [p.stem.replace("_monthly_report", "") for p in existing]

    # ============ 設定ビュー ============
    elif view == "settings":
        def _is_set(key: str) -> bool:
            return bool(os.getenv(key, "").strip())

        def _v(key: str, desc: str, required: bool) -> dict:
            return {"key": key, "desc": desc, "required": required, "configured": _is_set(key)}

        _char_names = _load_char_names()
        ctx["settings_data"] = {
            "char_names_config": [
                {"id": cid, "emoji": emoji, "name": _char_names.get(cid, _CHAR_NAMES_DEFAULTS.get(cid, cid))}
                for cid, emoji in _CHAR_EMOJI.items()
            ],
            "platforms": [
                {"name": "Threads", "emoji": "🧵", "mode": "自動投稿", "vars": [
                    _v("THREADS_USER_ID",      "ユーザー ID",          True),
                    _v("THREADS_ACCESS_TOKEN", "アクセストークン",      True),
                ]},
                {"name": "Instagram", "emoji": "📸", "mode": "自動投稿", "vars": [
                    _v("IG_BUSINESS_ACCOUNT_ID", "ビジネスアカウント ID", True),
                    _v("IG_ACCESS_TOKEN",         "アクセストークン",      True),
                ]},
                {"name": "X (Twitter)", "emoji": "🐦", "mode": "手動投稿", "vars": [
                    _v("X_ACCOUNT_HANDLE", "@ハンドル名（例: @your_handle）投稿ページ遷移に使用", False),
                ]},
                {"name": "note",        "emoji": "📝", "mode": "Cowork 経由", "vars": []},
                {"name": "Zenn",        "emoji": "👾", "mode": "自動投稿", "vars": [
                    _v("ZENN_REPO_PATH", "連携リポジトリのローカルパス", True),
                ]},
            ],
            "ai": [
                {"name": "Anthropic Claude", "emoji": "🤖", "vars": [
                    _v("ANTHROPIC_API_KEY",       "文章生成に使用（必須）",        True),
                    _v("ANTHROPIC_MODEL_DEFAULT", "使用モデル名（省略時は最新版）", False),
                ]},
                {"name": "Google Gemini (画像生成・無料枠あり)", "emoji": "✨", "vars": [
                    _v("GEMINI_API_KEY", "Imagen 3 画像生成に使用（Google AI Studio で無料取得可）", False),
                ]},
                {"name": "OpenAI / DALL-E (画像生成・有料)", "emoji": "🎨", "vars": [
                    _v("OPENAI_API_KEY", "DALL-E 3 画像生成に使用（有料。Gemini 優先）", False),
                ]},
                {"name": "Supabase", "emoji": "🗄️", "vars": [
                    _v("SUPABASE_URL",              "DB エンドポイント URL",  True),
                    _v("SUPABASE_SERVICE_ROLE_KEY", "サービスロールキー",      True),
                    _v("SUPABASE_STORAGE_BUCKET",   "画像保存バケット名",      False),
                ]},
            ],
            "notify": [
                {"name": "Discord", "emoji": "🎮", "vars": [
                    _v("DISCORD_WEBHOOK_URL", "通知先 Webhook URL", True),
                ]},
            ],
            "dashboard_cfg": [
                {"name": "ダッシュボード", "emoji": "🖥️", "vars": [
                    _v("DASHBOARD_BASIC_AUTH_USER", "ログインユーザー名",   True),
                    _v("DASHBOARD_BASIC_AUTH_PASS", "ログインパスワード",   True),
                    _v("DASHBOARD_BASE_URL",        "外部公開 URL（任意）", False),
                ]},
            ],
        }

    # ============ 勝ちパターンビュー ============
    elif view == "patterns":
        top = db.table("success_patterns").select("*").order("win_rate", desc=True).limit(20).execute().data or []
        ctx["top_patterns"]  = top[:10]
        ctx["lose_patterns"] = [p for p in top if p.get("win_rate", 1) < 0.5][:5]

    return templates.TemplateResponse(request=request, name="index.html", context=ctx)


def _calc_sales_stats(db: Client) -> dict:
    """営業 KPI 集計（全期間）"""
    leads_all   = db.table("leads").select("status, priority_score, found_at").execute().data or []
    outreach_all = db.table("outreach_history").select(
        "response_received, led_to_meeting, led_to_signup, sent_at"
    ).execute().data or []

    now_jst   = datetime.now(_JST)
    month_str = now_jst.strftime("%Y-%m")

    new_leads_month = sum(
        1 for r in leads_all
        if (r.get("found_at") or "").startswith(month_str)
    )
    sent  = len(outreach_all)
    replied  = sum(1 for r in outreach_all if r.get("response_received"))
    meetings = sum(1 for r in outreach_all if r.get("led_to_meeting"))
    signups  = sum(1 for r in outreach_all if r.get("led_to_signup"))
    reply_rate = f"{replied / sent * 100:.1f}%" if sent else "N/A"

    return {
        "total_leads":      len(leads_all),
        "new_leads_month":  new_leads_month,
        "sent":             sent,
        "replied":          replied,
        "reply_rate":       reply_rate,
        "meetings":         meetings,
        "signups":          signups,
    }


@router.get("/posts/{post_id}", response_class=HTMLResponse)
async def post_detail(
    post_id: str,
    request: Request,
    _user: str = Depends(_auth),
) -> HTMLResponse:
    db   = _db()
    rows = db.table("posts").select("*").eq("id", post_id).execute()
    if not rows.data:
        raise HTTPException(404, "投稿が見つかりません")
    post = _enrich(rows.data[0])

    return templates.TemplateResponse(
        request=request,
        name="post_detail.html",
        context={"post": post},
    )


@router.post("/posts/{post_id}/approve")
async def approve_post(
    post_id: str,
    _user: str = Depends(_auth),
) -> RedirectResponse:
    db   = _db()
    rows = db.table("posts").select("*").eq("id", post_id).execute()
    if not rows.data:
        raise HTTPException(404, "投稿が見つかりません")
    post = rows.data[0]

    if post["status"] not in ("draft", "approved"):
        raise HTTPException(400, f"status={post['status']} は承認できません")

    # approved に変更してから Publisher 経由で投稿
    db.table("posts").update({"status": "approved"}).eq("id", post_id).execute()

    pipeline = Pipeline()
    await pipeline.publish(post_id)

    return RedirectResponse(
        url=f"/dashboard/posts/{post_id}",
        status_code=303,
    )


@router.post("/posts/{post_id}/reject")
async def reject_post(
    post_id: str,
    _user: str = Depends(_auth),
) -> RedirectResponse:
    db = _db()
    db.table("posts").update({"status": "rejected"}).eq("id", post_id).execute()
    return RedirectResponse(url="/dashboard/", status_code=303)


# ============================================================
# 投稿 修正・再生成 API
# ============================================================

@router.post("/posts/{post_id}/update-content")
async def update_post_content(
    post_id: str,
    request: Request,
    _user: str = Depends(_auth),
) -> RedirectResponse:
    """投稿の本文・キャラ・言い回しを更新する"""
    db   = _db()
    form = await request.form()

    update_data: dict = {}
    if content := form.get("content"):
        update_data["content"] = str(content)
    if character_id := form.get("character_id"):
        update_data["character_id"] = str(character_id)
    if trigger_axis := form.get("trigger_axis"):
        update_data["trigger_axis"] = str(trigger_axis)
    if weapon := form.get("weapon"):
        update_data["weapon"] = str(weapon)

    if update_data:
        db.table("posts").update(update_data).eq("id", post_id).execute()

    redirect = str(form.get("redirect", "/dashboard/"))
    return RedirectResponse(url=redirect, status_code=303)


@router.post("/posts/{post_id}/regenerate")
async def regenerate_post(
    post_id: str,
    background_tasks: BackgroundTasks,
    _user: str = Depends(_auth),
) -> RedirectResponse:
    """同じプラットフォームで再生成。既存ドラフトは rejected に。即座にリダイレクト。"""
    db   = _db()
    rows = db.table("posts").select("platform").eq("id", post_id).execute()
    if not rows.data:
        raise HTTPException(404, "投稿が見つかりません")

    platform = rows.data[0]["platform"]
    db.table("posts").update({"status": "rejected"}).eq("id", post_id).execute()

    async def _do_generate() -> None:
        pipeline = Pipeline()
        await pipeline.generate(PlannerInput(platform_override=platform))

    background_tasks.add_task(_do_generate)
    return RedirectResponse(url="/dashboard/", status_code=303)


@router.post("/posts/{post_id}/regen-length")
async def regen_length_post(
    post_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    _user: str = Depends(_auth),
) -> RedirectResponse:
    """文字量を変えて再生成。既存ドラフトは rejected に。"""
    db   = _db()
    rows = db.table("posts").select("platform").eq("id", post_id).execute()
    if not rows.data:
        raise HTTPException(404, "投稿が見つかりません")

    form             = await request.form()
    target_chars_str = str(form.get("target_chars", "")).strip()
    redirect         = str(form.get("redirect", "/dashboard/"))
    platform         = rows.data[0]["platform"]

    if not target_chars_str:
        return RedirectResponse(url=redirect, status_code=303)
    try:
        target_chars = int(target_chars_str)
    except ValueError:
        return RedirectResponse(url=redirect, status_code=303)

    db.table("posts").update({"status": "rejected"}).eq("id", post_id).execute()

    async def _do_generate() -> None:
        pipeline = Pipeline()
        await pipeline.generate(PlannerInput(
            platform_override=platform,
            target_chars=target_chars,
        ))

    background_tasks.add_task(_do_generate)
    return RedirectResponse(url=redirect, status_code=303)


@router.post("/posts/{post_id}/regen-axis")
async def regen_axis_post(
    post_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    _user: str = Depends(_auth),
) -> RedirectResponse:
    """言い回しモードを変えて再生成。既存ドラフトは rejected に。"""
    db   = _db()
    rows = db.table("posts").select("platform").eq("id", post_id).execute()
    if not rows.data:
        raise HTTPException(404, "投稿が見つかりません")

    form         = await request.form()
    trigger_axis = str(form.get("trigger_axis", ""))
    redirect     = str(form.get("redirect", "/dashboard/"))
    platform     = rows.data[0]["platform"]

    db.table("posts").update({"status": "rejected"}).eq("id", post_id).execute()

    async def _do_generate() -> None:
        pipeline = Pipeline()
        await pipeline.generate(PlannerInput(
            platform_override=platform,
            trigger_axis_override=trigger_axis or None,
        ))

    background_tasks.add_task(_do_generate)
    return RedirectResponse(url=redirect, status_code=303)


# ============================================================
# 画像生成 / 添付
# ============================================================

async def _gen_image_gemini(prompt: str, api_key: str) -> bytes | None:
    """Gemini Imagen 3 / Flash で画像生成してバイト列を返す。失敗時は None。"""
    import base64
    import httpx as _httpx
    models = [
        "gemini-2.0-flash-preview-image-generation",
        "gemini-2.0-flash-exp-image-generation",
    ]
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]},
    }
    for model in models:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
        try:
            async with _httpx.AsyncClient(timeout=90) as hc:
                resp = await hc.post(url, json=payload)
            if resp.status_code != 200:
                continue
            for cand in resp.json().get("candidates", []):
                for part in cand.get("content", {}).get("parts", []):
                    if "inlineData" in part:
                        return base64.b64decode(part["inlineData"]["data"])
        except Exception:
            continue
    return None


async def _gen_image_openai(prompt: str, api_key: str) -> bytes | None:
    """DALL-E 3 で画像生成してバイト列を返す。失敗時は None。"""
    import httpx as _httpx
    from openai import AsyncOpenAI
    try:
        oai  = AsyncOpenAI(api_key=api_key)
        resp = await oai.images.generate(model="dall-e-3", prompt=prompt, size="1024x1024", n=1)
        url  = resp.data[0].url  # type: ignore[index]
        async with _httpx.AsyncClient(timeout=30) as hc:
            dl = await hc.get(url)
        return dl.content
    except Exception:
        return None


@router.post("/posts/{post_id}/generate-image")
async def generate_post_image(
    post_id: str,
    _user: str = Depends(_auth),
) -> RedirectResponse:
    """Gemini（優先・無料枠あり）または DALL-E 3 で画像生成し posts.image_url を更新"""
    gemini_key = os.getenv("GEMINI_API_KEY", "")
    openai_key = os.getenv("OPENAI_API_KEY", "")
    if not gemini_key and not openai_key:
        raise HTTPException(400, "GEMINI_API_KEY または OPENAI_API_KEY が未設定です（設定ページで確認）")

    db   = _db()
    rows = db.table("posts").select("content, platform").eq("id", post_id).execute()
    if not rows.data:
        raise HTTPException(404, "投稿が見つかりません")
    content = rows.data[0]["content"]

    prompt = (
        "Professional flat-design illustration for a Japanese accounting SaaS social media post. "
        "Warm pastel colors, clean minimal style, no text, no human faces. "
        f"Topic: {content[:300]}"
    )

    img_bytes: bytes | None = None
    if gemini_key:
        img_bytes = await _gen_image_gemini(prompt, gemini_key)
    if img_bytes is None and openai_key:
        img_bytes = await _gen_image_openai(prompt, openai_key)
    if img_bytes is None:
        raise HTTPException(500, "画像の生成に失敗しました。APIキーや使用量を確認してください")

    # Supabase Storage にアップロード → 永続 URL を取得
    image_url: str = ""
    bucket_name = os.getenv("SUPABASE_STORAGE_BUCKET", "visuals-bucket")
    try:
        bucket = db.storage.from_(bucket_name)
        fname  = f"posts/{post_id}.png"
        bucket.upload(fname, img_bytes, {"content-type": "image/png", "upsert": "true"})
        image_url = bucket.get_public_url(fname)
    except Exception:
        # ストレージ失敗時はローカル保存
        import base64
        image_url = f"data:image/png;base64,{base64.b64encode(img_bytes).decode()}"

    try:
        db.table("posts").update({"image_url": image_url}).eq("id", post_id).execute()
    except Exception:
        pass

    return RedirectResponse(url=f"/dashboard/posts/{post_id}", status_code=303)


@router.post("/posts/{post_id}/set-image-url")
async def set_post_image_url(
    post_id: str,
    request: Request,
    _user: str = Depends(_auth),
) -> RedirectResponse:
    """手動で画像 URL を設定する"""
    db   = _db()
    form = await request.form()
    url  = str(form.get("image_url", "")).strip()
    if url:
        try:
            db.table("posts").update({"image_url": url}).eq("id", post_id).execute()
        except Exception:
            pass
    return RedirectResponse(url=f"/dashboard/posts/{post_id}", status_code=303)


@router.post("/posts/{post_id}/remove-image")
async def remove_post_image(
    post_id: str,
    _user: str = Depends(_auth),
) -> RedirectResponse:
    """添付画像を削除する"""
    db = _db()
    try:
        db.table("posts").update({"image_url": None}).eq("id", post_id).execute()
    except Exception:
        pass
    return RedirectResponse(url=f"/dashboard/posts/{post_id}", status_code=303)


@router.post("/posts/{post_id}/upload-image")
async def upload_post_image(
    post_id: str,
    request: Request,
    _user: str = Depends(_auth),
) -> RedirectResponse:
    """ユーザーがアップロードした画像を Supabase Storage に保存し posts.image_url を更新"""
    import base64

    db   = _db()
    rows = db.table("posts").select("id").eq("id", post_id).execute()
    if not rows.data:
        raise HTTPException(404, "投稿が見つかりません")

    form       = await request.form()
    image_file = form.get("image_file")
    if not image_file or not hasattr(image_file, "read"):
        return RedirectResponse(url=f"/dashboard/posts/{post_id}", status_code=303)

    content_type: str = getattr(image_file, "content_type", "image/jpeg") or "image/jpeg"
    img_bytes: bytes  = await image_file.read()
    if not img_bytes:
        return RedirectResponse(url=f"/dashboard/posts/{post_id}", status_code=303)

    ext = "jpg" if "jpeg" in content_type else content_type.split("/")[-1].split(";")[0].strip() or "png"

    image_url: str = ""
    bucket_name = os.getenv("SUPABASE_STORAGE_BUCKET", "visuals-bucket")
    try:
        bucket    = db.storage.from_(bucket_name)
        fname     = f"posts/{post_id}_upload.{ext}"
        bucket.upload(fname, img_bytes, {"content-type": content_type, "upsert": "true"})
        image_url = bucket.get_public_url(fname)
    except Exception:
        image_url = f"data:{content_type};base64,{base64.b64encode(img_bytes).decode()}"

    if image_url:
        try:
            db.table("posts").update({"image_url": image_url}).eq("id", post_id).execute()
        except Exception:
            pass

    return RedirectResponse(url=f"/dashboard/posts/{post_id}", status_code=303)


# ============================================================
# P3-4: note 記事生成
# ============================================================

_NOTE_DRAFTS_DIR     = Path(__file__).parent / "output" / "note_drafts"
_COWORK_REQUESTS_DIR = Path(__file__).parent / "output" / "cowork_requests"
_REPORTS_DIR         = Path(__file__).parent / "output" / "reports"
_JST                 = ZoneInfo("Asia/Tokyo")


@router.post("/api/note/generate")
async def generate_note(
    _user: str = Depends(_auth),
) -> RedirectResponse:
    """
    note 向けドラフトを生成し、note_drafts/ に MD + meta.yaml を書き出す。
    Discord に「Cowork に依頼してください」と通知する。
    """
    pipeline = Pipeline()
    gen = await pipeline.generate(PlannerInput(platform_override="note"))

    if not gen.drafts or not gen.post_ids:
        raise HTTPException(500, "note ドラフト生成に失敗しました")

    draft   = gen.drafts[0]
    post_id = gen.post_ids[0]
    now_jst = datetime.now(_JST)
    date_str = now_jst.strftime("%Y-%m-%d")
    safe_title = draft.body[:20].replace("/", "／").replace("\n", " ").strip()
    stem = f"{date_str}_{safe_title}"

    _NOTE_DRAFTS_DIR.mkdir(parents=True, exist_ok=True)

    # Markdown 書き出し
    md_path = _NOTE_DRAFTS_DIR / f"{stem}.md"
    md_path.write_text(draft.body, encoding="utf-8")

    # meta.yaml 書き出し
    meta = {
        "post_id":       post_id,
        "title":         draft.body.splitlines()[0].lstrip("# ").strip(),
        "tags":          ["経理", "shiwake-ai"],
        "character":     draft.character_id,
        "weapon":        draft.weapon_id,
        "trigger":       draft.trigger_id,
        "target_persona": draft.persona_id,
        "draft_path":    f"./{stem}.md",
        "priority":      "standard",
        "generated_at":  now_jst.isoformat(),
    }
    meta_path = _NOTE_DRAFTS_DIR / f"{stem}.meta.yaml"
    meta_path.write_text(yaml.dump(meta, allow_unicode=True, sort_keys=False), encoding="utf-8")

    # Discord 通知
    from notify.discord import _post as discord_post
    discord_post({
        "embeds": [{
            "title":       "📝 note 下書き完成",
            "description": f"**{meta['title']}**\n\nCowork に依頼してください。",
            "color":       0x5865F2,
            "fields": [
                {"name": "ファイル", "value": f"`{stem}.md`", "inline": True},
                {"name": "post_id", "value": post_id,          "inline": True},
            ],
        }]
    })

    return RedirectResponse(url="/dashboard/", status_code=303)


# ============================================================
# P4-3: 営業 API
# ============================================================

@router.get("/api/sales/leads")
async def api_sales_leads(
    status: str = "",
    priority_min: int = 0,
    _user: str = Depends(_auth),
) -> JSONResponse:
    db = _db()
    q = db.table("leads").select("*").order("priority_score", desc=True)
    if status:
        q = q.eq("status", status)
    if priority_min:
        q = q.gte("priority_score", priority_min)
    rows = q.limit(100).execute().data or []
    return JSONResponse({"leads": rows})


@router.post("/api/sales/leads")
async def api_sales_leads_create(
    payload: dict = Body(...),
    _user: str = Depends(_auth),
) -> JSONResponse:
    db = _db()
    result = db.table("leads").insert(payload).execute()
    return JSONResponse({"created": result.data}, status_code=201)


@router.patch("/api/sales/leads/{lead_id}")
async def api_sales_leads_update(
    lead_id: str,
    payload: dict = Body(...),
    _user: str = Depends(_auth),
) -> JSONResponse:
    db = _db()
    db.table("leads").update(payload).eq("id", lead_id).execute()
    return JSONResponse({"updated": lead_id})


@router.get("/api/sales/stats")
async def api_sales_stats(_user: str = Depends(_auth)) -> JSONResponse:
    db = _db()
    return JSONResponse(_calc_sales_stats(db))


# ============================================================
# P4-3: 月次レポート API
# ============================================================

@router.get("/api/reports/monthly/{yyyy_mm}")
async def api_reports_monthly_get(
    yyyy_mm: str,
    _user: str = Depends(_auth),
) -> PlainTextResponse:
    path = _REPORTS_DIR / f"{yyyy_mm}_monthly_report.md"
    if not path.exists():
        raise HTTPException(404, f"{yyyy_mm} のレポートが見つかりません")
    return PlainTextResponse(path.read_text(encoding="utf-8"))


@router.post("/api/reports/monthly")
async def api_reports_monthly_trigger(
    request: Request,
    _user: str = Depends(_auth),
) -> RedirectResponse:
    now_jst = datetime.now(_JST)
    try:
        form  = await request.form()
        month = form.get("month") or now_jst.strftime("%Y-%m")
        fmt   = form.get("format", "md")
    except Exception:
        month = now_jst.strftime("%Y-%m")
        fmt   = "md"
    _trigger_cowork("monthly_report", {"month": month, "format": fmt}, "dashboard")
    return RedirectResponse(url=f"/dashboard/?view=reports&month={month}", status_code=303)


# ============================================================
# P4-3: Cowork トリガー API
# ============================================================

@router.post("/api/cowork/trigger")
async def api_cowork_trigger(
    request: Request,
    _user: str = Depends(_auth),
) -> RedirectResponse:
    form = await request.form()
    instruction = form.get("instruction") or ""
    if not instruction:
        # JSON body フォールバック
        try:
            body = await request.json()
            instruction = body.get("instruction", "")
            params = body.get("params", {})
        except Exception:
            raise HTTPException(400, "instruction が必要です")
    else:
        # フォームの params[key]=value をまとめる
        params: dict = {}
        for k, v in form.items():
            if k.startswith("params[") and k.endswith("]"):
                field = k[7:-1]
                params[field] = v

    if not instruction:
        raise HTTPException(400, "instruction が必要です")
    _trigger_cowork(instruction, params, "dashboard")

    view_map = {
        "lead_finder":     "sales",
        "outreach_writer": "sales",
        "monthly_report":  "reports",
        "image_generate":  "posts",
        "video_generator": "posts",
    }
    redirect_view = view_map.get(instruction, "posts")
    return RedirectResponse(url=f"/dashboard/?view={redirect_view}", status_code=303)


def _trigger_cowork(instruction: str, params: dict, requested_by: str = "dashboard") -> Path:
    """cowork_requests/ に実行依頼 JSON を書き出す"""
    _COWORK_REQUESTS_DIR.mkdir(parents=True, exist_ok=True)
    now_jst  = datetime.now(_JST)
    filename = f"{now_jst.strftime('%Y-%m-%d_%H%M%S')}_{instruction}.json"
    payload  = {
        "instruction":  instruction,
        "params":       params,
        "requested_at": now_jst.isoformat(),
        "requested_by": requested_by,
        "status":       "pending",
    }
    path = _COWORK_REQUESTS_DIR / filename
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


# ============================================================
# 設定保存 API
# ============================================================

@router.post("/api/settings/update")
async def api_settings_update(
    request: Request,
    _user: str = Depends(_auth),
) -> RedirectResponse:
    """環境変数を .env ファイルに保存する。空欄は無視。"""
    form = await request.form()
    env_path = str(_ENV_PATH)
    for key, value in form.multi_items():
        if key.startswith("env_") and isinstance(value, str) and value.strip():
            env_var = key[4:]
            try:
                _dotenv_set_key(env_path, env_var, value.strip())
                os.environ[env_var] = value.strip()
            except Exception:
                pass
    return RedirectResponse(url="/dashboard/?view=settings", status_code=303)


@router.post("/api/settings/char-names")
async def api_settings_char_names(
    request: Request,
    _user: str = Depends(_auth),
) -> RedirectResponse:
    """キャラクター表示名を保存する（ローカル JSON + Supabase Storage）。"""
    form  = await request.form()
    names = {k: str(v).strip() for k, v in form.items() if k in _CHAR_EMOJI and str(v).strip()}
    _save_char_names(names)
    templates.env.globals["_char_names"] = _load_char_names()
    return RedirectResponse(url="/dashboard/?view=settings", status_code=303)


# ============================================================
# P4-1: Zenn 記事生成 API
# ============================================================

@router.post("/api/zenn/generate")
async def generate_zenn(
    request: Request,
    _user: str = Depends(_auth),
) -> RedirectResponse:
    """Zenn 記事を生成して zenn_drafts/ に保存、Discord 通知"""
    form  = await request.form()
    topic = str(form.get("topic", "")).strip()
    if not topic:
        raise HTTPException(400, "topic が必要です")

    from brain.zenn_writer import cmd_generate as _gen
    import types
    ns = types.SimpleNamespace(topic=topic)

    import asyncio
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _gen, ns)

    return RedirectResponse(url="/dashboard/?view=posts", status_code=303)


# ============================================================
# P3-3: 自動化解禁 API
# ============================================================

@router.post("/api/automation/{platform}/toggle")
async def toggle_automation(
    platform: str,
    _user: str = Depends(_auth),
) -> RedirectResponse:
    """プラットフォームの auto_publish トグルを切り替える"""
    db = _db()
    rows = db.table("automation_settings").select("auto_publish").eq("platform", platform).execute()
    if not rows.data:
        raise HTTPException(404, f"platform={platform} の設定が見つかりません")

    current = rows.data[0]["auto_publish"]
    db.table("automation_settings").update({
        "auto_publish": not current,
        "updated_at":   datetime.now(timezone.utc).isoformat(),
        "updated_by":   "dsk",
    }).eq("platform", platform).execute()

    return RedirectResponse(url="/dashboard/", status_code=303)
