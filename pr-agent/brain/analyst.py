"""
P2-1: Analyst ノード — エンゲージメント計測 + バズ判定

投稿後 30min / 3h / 24h のタイミングで Threads / Instagram API から
エンゲージメントを取得し engagements テーブルに記録する。

バズ閾値を超えた場合は Discord に通知する（Panic ノードへの橋渡し）。

CLI:
  # 特定投稿を手動計測
  uv run python -m brain.analyst --post-id <uuid> --elapsed 30

  # 計測期限が来た投稿を一括処理（cron 用）
  uv run python -m brain.analyst --run-due
"""

import argparse
import asyncio
import os
from datetime import datetime, timedelta, timezone

import httpx
from dotenv import load_dotenv
from pydantic import BaseModel
from supabase import create_client, Client

from notify.discord import notify_published, notify_error

load_dotenv()

_THREADS_BASE = "https://graph.threads.net/v1.0"
_IG_BASE      = "https://graph.facebook.com/v19.0"

# 計測タイミング（分）
ELAPSED_STEPS = (30, 180, 1440)

# ウィンドウ: elapsed_min ± この値以内の投稿を「計測期限あり」とみなす
_WINDOW_MIN = 10

# バズ判定閾値 {elapsed_min: {metric: threshold}}
_BUZZ_THRESHOLDS: dict[int, dict[str, int]] = {
    30:   {"likes": 10,  "comments": 5},
    180:  {"likes": 30,  "comments": 10},
    1440: {"likes": 100, "comments": 20},
}


# ============================================================
# I/O モデル
# ============================================================

class EngagementData(BaseModel):
    post_id:     str
    elapsed_min: int
    platform:    str
    impressions: int = 0
    likes:       int = 0
    comments:    int = 0
    shares:      int = 0
    saves:       int = 0
    clicks:      int = 0
    raw:         dict = {}


class AnalystOutput(BaseModel):
    post_id:      str
    elapsed_min:  int
    engagement:   EngagementData
    is_buzz:      bool
    buzz_metrics: dict[str, int] = {}   # 閾値を超えた指標
    saved_id:     str | None = None     # engagements.id


# ============================================================
# Threads API
# ============================================================

async def _fetch_threads(media_id: str, client: httpx.AsyncClient) -> dict:
    """Threads Media オブジェクトからエンゲージメントを取得する"""
    token = os.environ["THREADS_ACCESS_TOKEN"]
    resp  = await client.get(
        f"{_THREADS_BASE}/{media_id}",
        params={
            "fields":       "like_count,reply_count,repost_count,quote_count",
            "access_token": token,
        },
    )
    resp.raise_for_status()
    data = resp.json()
    return {
        "likes":    data.get("like_count",    0),
        "comments": data.get("reply_count",   0),
        "shares":   data.get("repost_count",  0),
        "raw":      data,
    }


# ============================================================
# Instagram Graph API
# ============================================================

async def _fetch_instagram(media_id: str, client: httpx.AsyncClient) -> dict:
    """Instagram Media インサイトからエンゲージメントを取得する"""
    token = os.environ["IG_ACCESS_TOKEN"]
    resp  = await client.get(
        f"{_IG_BASE}/{media_id}/insights",
        params={
            "metric":       "impressions,reach,likes,comments,shares,saved",
            "access_token": token,
        },
    )
    resp.raise_for_status()
    raw  = resp.json()
    vals = {item["name"]: item["values"][0]["value"] for item in raw.get("data", [])}
    return {
        "impressions": vals.get("impressions", 0),
        "likes":       vals.get("likes",       0),
        "comments":    vals.get("comments",    0),
        "shares":      vals.get("shares",      0),
        "saves":       vals.get("saved",       0),
        "raw":         raw,
    }


# ============================================================
# バズ判定
# ============================================================

def _check_buzz(elapsed_min: int, eng: EngagementData) -> dict[str, int]:
    """閾値を超えた指標を {metric: value} で返す。空なら非バズ。"""
    thresholds = _BUZZ_THRESHOLDS.get(elapsed_min, {})
    return {
        metric: getattr(eng, metric)
        for metric, threshold in thresholds.items()
        if getattr(eng, metric, 0) >= threshold
    }


# ============================================================
# Analyst ノード
# ============================================================

class AnalystNode:
    def __init__(self) -> None:
        url = os.getenv("SUPABASE_URL", "")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
        self._db: Client | None = create_client(url, key) if url and key else None

    async def run(self, post_id: str, elapsed_min: int) -> AnalystOutput:
        if not self._db:
            raise RuntimeError("Supabase 未接続")

        # posts から external_id と platform を取得
        rows = self._db.table("posts").select("platform, external_id").eq("id", post_id).execute()
        if not rows.data:
            raise ValueError(f"post_id={post_id} が見つかりません")
        post     = rows.data[0]
        platform = post["platform"]
        media_id = post.get("external_id")

        if not media_id:
            raise ValueError(f"post_id={post_id} に external_id がありません（未公開？）")

        # プラットフォーム別にエンゲージメント取得
        async with httpx.AsyncClient(timeout=15.0) as client:
            if platform == "threads":
                metrics = await _fetch_threads(media_id, client)
            elif platform == "instagram":
                metrics = await _fetch_instagram(media_id, client)
            else:
                raise ValueError(f"Analyst は platform={platform} に未対応（threads/instagram のみ）")

        eng = EngagementData(
            post_id=post_id,
            elapsed_min=elapsed_min,
            platform=platform,
            **{k: v for k, v in metrics.items() if k != "raw"},
            raw=metrics.get("raw", {}),
        )

        # engagements テーブルに保存（重複チェック: 同 post_id × elapsed_min は1件のみ）
        existing = (
            self._db.table("engagements")
            .select("id")
            .eq("post_id", post_id)
            .eq("elapsed_min", elapsed_min)
            .execute()
        )
        if existing.data:
            saved_id = existing.data[0]["id"]
            self._db.table("engagements").update({
                "impressions": eng.impressions,
                "likes":       eng.likes,
                "comments":    eng.comments,
                "shares":      eng.shares,
                "saves":       eng.saves,
                "clicks":      eng.clicks,
                "raw":         eng.raw,
                "measured_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", saved_id).execute()
        else:
            result = self._db.table("engagements").insert({
                "post_id":     post_id,
                "elapsed_min": elapsed_min,
                "impressions": eng.impressions,
                "likes":       eng.likes,
                "comments":    eng.comments,
                "shares":      eng.shares,
                "saves":       eng.saves,
                "clicks":      eng.clicks,
                "raw":         eng.raw,
            }).execute()
            saved_id = result.data[0]["id"]

        # バズ判定
        buzz_metrics = _check_buzz(elapsed_min, eng)
        is_buzz      = bool(buzz_metrics)

        if is_buzz:
            _notify_buzz(post_id, platform, elapsed_min, eng, buzz_metrics)

        return AnalystOutput(
            post_id=post_id,
            elapsed_min=elapsed_min,
            engagement=eng,
            is_buzz=is_buzz,
            buzz_metrics=buzz_metrics,
            saved_id=saved_id,
        )

    # ------------------------------------------------------------------
    async def run_due(self) -> list[AnalystOutput]:
        """計測期限が来た投稿を一括処理する（cron 用）"""
        if not self._db:
            raise RuntimeError("Supabase 未接続")

        results = []
        now     = datetime.now(timezone.utc)

        for elapsed in ELAPSED_STEPS:
            # elapsed_min 前後 _WINDOW_MIN 分以内に published になった投稿を探す
            lo = (now - timedelta(minutes=elapsed + _WINDOW_MIN)).isoformat()
            hi = (now - timedelta(minutes=elapsed - _WINDOW_MIN)).isoformat()

            rows = (
                self._db.table("posts")
                .select("id, platform, external_id")
                .eq("status", "published")
                .in_("platform", ["threads", "instagram"])
                .gte("published_at", lo)
                .lte("published_at", hi)
                .execute()
            )
            for post in rows.data or []:
                # 既に計測済みならスキップ
                done = (
                    self._db.table("engagements")
                    .select("id")
                    .eq("post_id", post["id"])
                    .eq("elapsed_min", elapsed)
                    .execute()
                )
                if done.data:
                    continue
                try:
                    out = await self.run(post["id"], elapsed)
                    results.append(out)
                    print(f"[analyst] {post['id'][:8]}… elapsed={elapsed}min "
                          f"likes={out.engagement.likes} buzz={out.is_buzz}")
                except Exception as e:
                    notify_error(e, context=f"Analyst elapsed={elapsed}")

        return results


# ============================================================
# バズ Discord 通知
# ============================================================

def _notify_buzz(
    post_id: str,
    platform: str,
    elapsed_min: str,
    eng: EngagementData,
    buzz_metrics: dict[str, int],
) -> None:
    import httpx as _httpx
    webhook = os.getenv("DISCORD_WEBHOOK_URL", "")
    if not webhook:
        return
    label   = {30: "30分", 180: "3時間", 1440: "24時間"}.get(elapsed_min, f"{elapsed_min}分")
    metrics = "  ".join(f"{k}={v}" for k, v in buzz_metrics.items())
    payload = {
        "embeds": [{
            "title":       f"🔥 バズ検知 ({label}) — {platform}",
            "description": f"**{metrics}** が閾値超え\npost_id: `{post_id}`",
            "color":       0xFEE75C,
            "fields": [
                {"name": "likes",    "value": str(eng.likes),    "inline": True},
                {"name": "comments", "value": str(eng.comments), "inline": True},
                {"name": "shares",   "value": str(eng.shares),   "inline": True},
            ],
        }]
    }
    try:
        with _httpx.Client(timeout=10) as client:
            client.post(webhook, json=payload).raise_for_status()
    except Exception:
        pass


# ============================================================
# CLI
# ============================================================

async def _cli_main(args: argparse.Namespace) -> None:
    node = AnalystNode()

    if args.run_due:
        results = await node.run_due()
        print(f"[analyst] run-due 完了: {len(results)} 件計測")
        return

    if not args.post_id or not args.elapsed:
        print("--post-id と --elapsed が必要です（または --run-due）")
        return

    out = await node.run(args.post_id, args.elapsed)
    eng = out.engagement
    print(f"[analyst] post_id={out.post_id[:8]}…  elapsed={out.elapsed_min}min  platform={eng.platform}")
    print(f"  likes={eng.likes}  comments={eng.comments}  shares={eng.shares}"
          f"  saves={eng.saves}  impressions={eng.impressions}")
    if out.is_buzz:
        print(f"  🔥 バズ検知: {out.buzz_metrics}")
    print(f"  saved_id={out.saved_id}")


def main() -> None:
    parser = argparse.ArgumentParser(description="shiwake-ai Analyst ノード CLI")
    parser.add_argument("--post-id",  help="計測対象の posts.id")
    parser.add_argument("--elapsed",  type=int, choices=[30, 180, 1440],
                        help="経過分数 (30 / 180 / 1440)")
    parser.add_argument("--run-due",  action="store_true",
                        help="計測期限が来た投稿を一括処理")
    asyncio.run(_cli_main(parser.parse_args()))


if __name__ == "__main__":
    main()
