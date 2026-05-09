"""
P3-5: 勝ちパターン抽出

posts × engagements を集計して、
(persona_id × character_id × weapon_id × trigger_id × platform) ごとの
勝率を success_patterns テーブルに集計する。

成功の定義:
  eng_rate = (likes + shares*2 + comments*3) / impressions >= 1.5%

CLI:
  uv run python -m brain.pattern_aggregator rebuild          # 全件再集計
  uv run python -m brain.pattern_aggregator daily            # 直近24h差分更新
  uv run python -m brain.pattern_aggregator top [--n 5]     # 勝率トップN表示
"""

import argparse
import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

_SUPABASE_URL  = os.getenv("SUPABASE_URL", "")
_SUPABASE_KEY  = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
_SUCCESS_RATE  = 0.015   # 1.5%


class PatternAggregator:
    def __init__(self) -> None:
        self._supabase: Client = create_client(_SUPABASE_URL, _SUPABASE_KEY)

    # ------------------------------------------------------------------
    def rebuild(self) -> int:
        """全 published 投稿を再集計して success_patterns を UPSERT する"""
        posts = self._fetch_posts(since=None)
        return self._aggregate_and_upsert(posts)

    def daily(self) -> int:
        """直近24hの published 投稿を差分更新する"""
        since = datetime.now(timezone.utc) - timedelta(hours=24)
        posts = self._fetch_posts(since=since)
        return self._aggregate_and_upsert(posts)

    def top(self, n: int = 5) -> list[dict]:
        """勝率トップN を返す"""
        rows = (
            self._supabase.table("success_patterns")
            .select("*")
            .order("win_rate", desc=True)
            .limit(n)
            .execute()
        ).data
        return rows or []

    # ------------------------------------------------------------------
    def _fetch_posts(self, since: datetime | None) -> list[dict]:
        """published 投稿を取得する"""
        q = (
            self._supabase.table("posts")
            .select("id,persona,character_id,weapon,trigger_axis,platform,published_at")
            .eq("status", "published")
            .order("published_at", desc=True)
        )
        if since:
            q = q.gte("published_at", since.isoformat())
        return (q.limit(500).execute()).data or []

    def _fetch_engagement(self, post_id: str) -> dict | None:
        """post の最新 engagement を返す(24h 優先)"""
        rows = (
            self._supabase.table("engagements")
            .select("impressions,likes,comments,shares")
            .eq("post_id", post_id)
            .order("elapsed_min", desc=True)
            .limit(1)
            .execute()
        ).data
        return rows[0] if rows else None

    def _calc_eng_rate(self, eng: dict) -> float:
        imp = eng.get("impressions") or 0
        if imp == 0:
            return 0.0
        likes    = eng.get("likes", 0) or 0
        shares   = eng.get("shares", 0) or 0
        comments = eng.get("comments", 0) or 0
        return (likes + shares * 2 + comments * 3) / imp

    def _aggregate_and_upsert(self, posts: list[dict]) -> int:
        """コンボ別に集計して success_patterns を UPSERT する"""
        # コンボキー → {win, loss, eng_rates, likes_list}
        buckets: dict[tuple, dict] = defaultdict(
            lambda: {"win": 0, "loss": 0, "eng_rates": [], "likes": []}
        )

        for post in posts:
            key = (
                post.get("persona", ""),
                post.get("character_id", ""),
                post.get("weapon", ""),
                post.get("trigger_axis", ""),
                post.get("platform", ""),
            )
            eng = self._fetch_engagement(post["id"])
            if not eng:
                continue

            rate  = self._calc_eng_rate(eng)
            likes = eng.get("likes", 0) or 0

            buckets[key]["eng_rates"].append(rate)
            buckets[key]["likes"].append(likes)
            if rate >= _SUCCESS_RATE:
                buckets[key]["win"] += 1
            else:
                buckets[key]["loss"] += 1

        upserted = 0
        for (persona_id, character_id, weapon_id, trigger_id, platform), b in buckets.items():
            if not all([persona_id, character_id, weapon_id, trigger_id, platform]):
                continue
            sample    = b["win"] + b["loss"]
            win_rate  = round(b["win"] / sample, 4) if sample > 0 else None
            avg_rate  = round(sum(b["eng_rates"]) / len(b["eng_rates"]), 6) if b["eng_rates"] else None
            avg_likes = round(sum(b["likes"]) / len(b["likes"]), 2) if b["likes"] else None

            self._supabase.table("success_patterns").upsert({
                "persona_id":          persona_id,
                "character_id":        character_id,
                "weapon_id":           weapon_id,
                "trigger_id":          trigger_id,
                "platform":            platform,
                "sample_count":        sample,
                "avg_engagement_rate": avg_rate,
                "avg_likes":           avg_likes,
                "win_count":           b["win"],
                "loss_count":          b["loss"],
                "win_rate":            win_rate,
                "last_updated_at":     datetime.now(timezone.utc).isoformat(),
            }, on_conflict="persona_id,character_id,weapon_id,trigger_id,platform").execute()
            upserted += 1

        return upserted


# ============================================================
# CLI
# ============================================================

def main() -> None:
    p   = argparse.ArgumentParser(description="勝ちパターン集計 CLI")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("rebuild", help="全 published 投稿を再集計")
    sub.add_parser("daily",   help="直近24h の差分更新")

    top_p = sub.add_parser("top", help="勝率トップN 表示")
    top_p.add_argument("--n", type=int, default=5)

    args = p.parse_args()
    agg  = PatternAggregator()

    if args.cmd in ("rebuild", "daily"):
        fn      = agg.rebuild if args.cmd == "rebuild" else agg.daily
        updated = fn()
        print(f"[pattern] {args.cmd}: {updated} パターンを更新しました")

    elif args.cmd == "top":
        rows = agg.top(n=args.n)
        if not rows:
            print("[pattern] データなし")
            return
        print(f"[pattern] 勝率トップ{args.n}:")
        for i, r in enumerate(rows, 1):
            wr  = r.get("win_rate")
            win = r.get("win_count", 0)
            n   = r.get("sample_count", 0)
            wr_str = f"{wr * 100:.1f}%" if wr is not None else "N/A"
            print(
                f"  {i}. {r['persona_id']} × {r['character_id']} × "
                f"{r['weapon_id']} × {r['trigger_id']} @{r['platform']}"
                f"  → 勝率 {wr_str}({win}/{n})"
            )


if __name__ == "__main__":
    main()
