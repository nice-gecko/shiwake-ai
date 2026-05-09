"""
T2-4: Discord 通知モジュール

送信する通知:
  notify_drafts()    — 朝の3案生成後。Embed×3 + 承認ダッシュボードリンク
  notify_published() — 投稿完了後。プラットフォーム・URL を通知
  notify_error()     — 例外発生時のアラート

Webhook URL は環境変数 DISCORD_WEBHOOK_URL から読む。
"""

import os
from datetime import datetime

import httpx
from dotenv import load_dotenv

from brain.writer import DraftPost

load_dotenv()

_WEBHOOK_URL = os.getenv("DISCORD_WEBHOOK_URL", "")

# プラットフォーム別の絵文字
_PLATFORM_EMOJI = {
    "x":         "🐦",
    "threads":   "🧵",
    "instagram": "📸",
    "note":      "📝",
    "zenn":      "👾",
}

# ステータス別の色 (Discord embed color, decimal)
_COLOR_INFO    = 0x5865F2   # Discord ブルー
_COLOR_SUCCESS = 0x57F287   # グリーン
_COLOR_WARNING = 0xFEE75C   # イエロー
_COLOR_ERROR   = 0xED4245   # レッド


# ============================================================
# 内部ヘルパー
# ============================================================

def _post(payload: dict) -> None:
    """Discord Webhook に POST する。失敗は print で警告してスローしない。"""
    if not _WEBHOOK_URL:
        print("[discord] DISCORD_WEBHOOK_URL が未設定。通知スキップ。")
        return
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.post(_WEBHOOK_URL, json=payload)
            resp.raise_for_status()
    except Exception as e:
        print(f"[discord] 通知失敗: {e}")


def _draft_embed(draft: DraftPost, post_id: str, dashboard_url: str) -> dict:
    """1案分の Discord Embed を生成する"""
    platform_emoji = _PLATFORM_EMOJI.get(draft.platform, "📣")
    over_warning   = "  ⚠️ 文字数超過" if draft.over_limit else ""

    # 本文が長い場合は先頭 300 文字に切り詰め
    body_preview = draft.body if len(draft.body) <= 300 else draft.body[:297] + "…"

    approve_url = f"{dashboard_url}/posts/{post_id}/approve"

    return {
        "title":       f"{platform_emoji} 案{draft.angle}  [{draft.char_count}字{over_warning}]",
        "description": f"```\n{body_preview}\n```",
        "color":       _COLOR_WARNING if draft.over_limit else _COLOR_INFO,
        "fields": [
            {
                "name":   "キャラ / 構文 / トリガー",
                "value":  f"`{draft.character_id}` / `{draft.weapon_id}` / `{draft.trigger_id}`",
                "inline": True,
            },
            {
                "name":   "承認",
                "value":  f"[ダッシュボードで承認]({approve_url})",
                "inline": True,
            },
        ],
    }


# ============================================================
# 公開関数
# ============================================================

def notify_drafts(
    drafts: list[DraftPost],
    post_ids: list[str],
    scheduled_at: datetime,
    dashboard_base_url: str | None = None,
) -> None:
    """
    3案生成完了を Discord に通知する。

    Args:
        drafts:            WriterOutput.drafts (3案)
        post_ids:          Supabase posts.id のリスト (drafts と同順)
        scheduled_at:      Planner が決定した投稿予定時刻
        dashboard_base_url: 承認ダッシュボードのベース URL
    """
    base_url = dashboard_base_url or os.getenv("DASHBOARD_BASE_URL", "http://localhost:8000")
    platform = drafts[0].platform if drafts else "?"
    emoji    = _PLATFORM_EMOJI.get(platform, "📣")
    sched    = scheduled_at.strftime("%Y-%m-%d %H:%M JST")

    embeds = [
        {
            "title":       f"✍️ 投稿3案が生成されました",
            "description": f"{emoji} **{platform}**  |  投稿予定: **{sched}**\n"
                           f"承認ダッシュボード: {base_url}",
            "color":       _COLOR_INFO,
        }
    ]
    for draft, pid in zip(drafts, post_ids):
        embeds.append(_draft_embed(draft, pid, base_url))

    _post({"embeds": embeds})
    print(f"[discord] 3案通知送信: platform={platform} scheduled={sched}")


def notify_published(
    post_id: str,
    platform: str,
    status: str,
    external_url: str | None = None,
    message: str = "",
) -> None:
    """
    投稿完了（または手動投稿待ち）を Discord に通知する。

    Args:
        post_id:      Supabase posts.id
        platform:     投稿プラットフォーム
        status:       'published' | 'awaiting_manual_post'
        external_url: 公開 URL (published 時)
        message:      追加メッセージ
    """
    emoji = _PLATFORM_EMOJI.get(platform, "📣")

    if status == "published":
        title  = f"✅ {emoji} {platform} 投稿完了"
        color  = _COLOR_SUCCESS
        desc   = f"[投稿を確認する]({external_url})" if external_url else "投稿完了"
    else:
        title  = f"⏳ {emoji} {platform} 手動投稿待ち"
        color  = _COLOR_WARNING
        desc   = message or "承認ダッシュボードからコピーして投稿してください。"

    _post({
        "embeds": [{
            "title":       title,
            "description": desc,
            "color":       color,
            "footer":      {"text": f"post_id: {post_id}"},
        }]
    })
    print(f"[discord] 投稿通知送信: platform={platform} status={status}")


def notify_error(error: Exception, context: str = "") -> None:
    """
    エラー発生を Discord に通知する。

    Args:
        error:   発生した例外
        context: どのノードで発生したか ("Planner", "Writer" など)
    """
    label = f"[{context}] " if context else ""
    _post({
        "embeds": [{
            "title":       f"🚨 {label}エラー発生",
            "description": f"```\n{type(error).__name__}: {error}\n```",
            "color":       _COLOR_ERROR,
        }]
    })
    print(f"[discord] エラー通知送信: {context} {error}")
