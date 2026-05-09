"""
P3-3: 成功率算出ロジック

SuccessRateCalculator:
  直近 N 件の published 投稿について、エンゲージメント率を算出し
  成功率(rate)とシステム推奨("解禁可能" / "継続観察")を返す。

成功の定義:
  エンゲージメント率 = (likes + shares*2 + comments*3) / impressions
  1.5% 以上 → success
  75% 以上の投稿が success → 「解禁可能」

CLI:
  uv run python -m brain.analytics --platform threads [--sample 20]
"""

import argparse
import os
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

_SUPABASE_URL  = os.getenv("SUPABASE_URL", "")
_SUPABASE_KEY  = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
_SUCCESS_RATE  = 0.015   # エンゲージメント率 1.5% 以上で success
_UNLOCK_THRESH = 0.75    # 成功率 75% 以上で「解禁可能」


class SuccessRateCalculator:
    def __init__(self) -> None:
        self._supabase: Client = create_client(_SUPABASE_URL, _SUPABASE_KEY)

    def calc(self, platform: str, sample_size: int = 20) -> dict:
        """
        直近 sample_size 件の公開済み投稿の成功率を返す。

        Returns:
            {
              success: int,
              failure: int,
              rate: float,          # 0.0〜1.0
              sample: int,          # 実際に計測できた件数
              recommendation: str,  # "解禁可能" | "継続観察" | "データ不足"
            }
        """
        # 1. 直近 N 件の published posts を取得
        posts = (
            self._supabase.table("posts")
            .select("id")
            .eq("platform", platform)
            .eq("status", "published")
            .order("published_at", desc=True)
            .limit(sample_size)
            .execute()
        ).data

        if not posts:
            return {"success": 0, "failure": 0, "rate": 0.0, "sample": 0, "recommendation": "データ不足"}

        success = 0
        failure = 0

        for post in posts:
            post_id = post["id"]

            # 2. 最新のエンゲージメントを取得(24h優先、なければ最新)
            engs = (
                self._supabase.table("engagements")
                .select("impressions,likes,comments,shares")
                .eq("post_id", post_id)
                .order("elapsed_min", desc=True)
                .limit(1)
                .execute()
            ).data

            if not engs:
                continue

            eng = engs[0]
            imp = eng.get("impressions") or 0
            if imp == 0:
                continue

            # 3. エンゲージメント率算出
            likes    = eng.get("likes", 0) or 0
            shares   = eng.get("shares", 0) or 0
            comments = eng.get("comments", 0) or 0
            eng_rate = (likes + shares * 2 + comments * 3) / imp

            # 4. 閾値判定
            if eng_rate >= _SUCCESS_RATE:
                success += 1
            else:
                failure += 1

        measured = success + failure
        rate     = success / measured if measured > 0 else 0.0

        if measured < 5:
            recommendation = "データ不足"
        elif rate >= _UNLOCK_THRESH:
            recommendation = "解禁可能"
        else:
            recommendation = "継続観察"

        return {
            "success":        success,
            "failure":        failure,
            "rate":           round(rate, 3),
            "sample":         measured,
            "recommendation": recommendation,
        }


# ============================================================
# CLI
# ============================================================

def main() -> None:
    p = argparse.ArgumentParser(description="成功率算出 CLI")
    p.add_argument("--platform", default="threads", help="対象プラットフォーム")
    p.add_argument("--sample",   type=int, default=20, help="直近N件")
    args = p.parse_args()

    calc   = SuccessRateCalculator()
    result = calc.calc(args.platform, sample_size=args.sample)

    print(f"[analytics] platform={args.platform}  sample={result['sample']}")
    print(f"  成功: {result['success']}件 / 失敗: {result['failure']}件")
    print(f"  成功率: {result['rate'] * 100:.1f}%")
    print(f"  推奨: {result['recommendation']}")


if __name__ == "__main__":
    main()
