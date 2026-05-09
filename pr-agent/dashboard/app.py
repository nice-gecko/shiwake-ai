"""
T2-3: 承認ダッシュボード

Routes:
  GET  /dashboard/          — ドラフト一覧 (status フィルタ付き)
  GET  /dashboard/posts/{id} — 投稿詳細 + 承認 / 却下 / X コピー UI
  POST /dashboard/posts/{id}/approve — 承認 → Publisher 呼び出し
  POST /dashboard/posts/{id}/reject  — 却下

Basic Auth: DASHBOARD_BASIC_AUTH_USER / DASHBOARD_BASIC_AUTH_PASS
"""

import asyncio
import os
import secrets
from pathlib import Path

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.templating import Jinja2Templates
from supabase import create_client, Client

from brain.analytics import SuccessRateCalculator
from brain.pipeline import Pipeline
from brain.publisher import PublisherInput

load_dotenv()

router    = APIRouter(prefix="/dashboard")
security  = HTTPBasic()
templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))

_PLATFORM_EMOJI = {"x": "🐦", "threads": "🧵", "instagram": "📸", "note": "📝", "zenn": "👾"}
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
    _user: str = Depends(_auth),
) -> HTMLResponse:
    db = _db()

    query = db.table("posts").select(
        "id, platform, persona, character_id, weapon, trigger_axis, status, "
        "content, scheduled_at, published_at, external_url, created_at"
    ).order("created_at", desc=True)

    if status_filter != "all":
        query = query.eq("status", status_filter)

    rows = query.limit(50).execute()
    posts = [_enrich(p) for p in (rows.data or [])]

    # 各ステータスのカウント
    counts_raw = db.table("posts").select("status").execute()
    counts: dict[str, int] = {}
    for r in counts_raw.data or []:
        s = r["status"]
        counts[s] = counts.get(s, 0) + 1
    counts["all"] = sum(counts.values())

    # 自動化設定 + 成功率を取得
    auto_settings: dict[str, dict] = {}
    try:
        auto_rows = db.table("automation_settings").select("*").execute()
        calc = SuccessRateCalculator()
        for row in (auto_rows.data or []):
            pf = row["platform"]
            auto_settings[pf] = {**row, "rate_info": calc.calc(pf)}
    except Exception:
        pass

    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={
            "posts":         posts,
            "status_filter": status_filter,
            "counts":        counts,
            "status_labels": _STATUS_LABEL,
            "auto_settings": auto_settings,
        },
    )


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
        "updated_at":   "now()",
        "updated_by":   "dsk",
    }).eq("platform", platform).execute()

    return RedirectResponse(url="/dashboard/", status_code=303)
