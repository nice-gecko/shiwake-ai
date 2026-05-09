"""
P3-1: Panic ノード — バズ検知 + セルフリプライ案生成

発火条件:
  (engagements の最新値が absolute を超え) AND (過去N投稿平均 × multiplier を超える)
  ※ 過去データなし(冷起動)の場合は絶対値のみで判定

動作:
  1. engagements テーブルから check_at_minutes 時点の最新値を取得
  2. config/panic_thresholds.yaml と照合
  3. 発火 → Anthropic API でセルフリプライ案を生成
  4. Discord に通知(承認待ち)
  5. cooldown 記録(panic_log テーブル)

CLI:
  uv run python -m brain.panic check                       # 全post対象でバズ判定
  uv run python -m brain.panic generate --post-id <UUID>   # 特定postのリプ案生成(テスト用)
"""

import argparse
import asyncio
import os
import yaml
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from anthropic import Anthropic
from dotenv import load_dotenv
from pydantic import BaseModel
from supabase import create_client, Client

load_dotenv()

_SUPABASE_URL    = os.getenv("SUPABASE_URL", "")
_SUPABASE_KEY    = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
_ANTHROPIC_KEY   = os.getenv("ANTHROPIC_API_KEY", "")

_THRESHOLDS_PATH = Path(__file__).parent.parent / "config" / "panic_thresholds.yaml"


class BuzzSignal(BaseModel):
    post_id:     str
    platform:    str
    checkpoint:  str        # "30min" | "180min"
    likes:       int
    reposts:     int        # engagements.shares に対応
    impressions: int
    triggered:   bool
    reason:      str        # 人間可読な発火理由


class PanicReplyDraft(BaseModel):
    post_id:    str
    parent_url: Optional[str]
    text:       str         # セルフリプライ本文(280字以内)
    char_count: int
    rationale:  str


class PanicNode:
    def __init__(self) -> None:
        self._supabase: Client = create_client(_SUPABASE_URL, _SUPABASE_KEY)
        self._claude = Anthropic(api_key=_ANTHROPIC_KEY)
        with open(_THRESHOLDS_PATH) as f:
            self._cfg = yaml.safe_load(f)

    # ------------------------------------------------------------------
    async def check_all_recent(self, hours: int = 24) -> list[BuzzSignal]:
        """直近 N 時間で公開された投稿について、バズ判定を全件実行"""
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
        rows = (
            self._supabase.table("posts")
            .select("id,platform,published_at")
            .eq("status", "published")
            .gte("published_at", cutoff)
            .execute()
        ).data
        results: list[BuzzSignal] = []
        for row in rows:
            sig = await self._check_one(row["id"], row["platform"])
            if sig:
                results.append(sig)
        return results

    async def _check_one(self, post_id: str, platform: str) -> Optional[BuzzSignal]:
        """1件の post に対してバズ判定"""
        if self._is_in_cooldown(post_id):
            return None

        eng = self._latest_engagements(post_id)
        if not eng:
            return None

        cfg     = self._cfg.get(platform, {})
        abs_cfg = cfg.get("absolute", {})

        reposts = eng.get("shares", 0)
        abs_passed = (
            eng.get("likes", 0) >= abs_cfg.get("likes", 999_999)
            or reposts          >= abs_cfg.get("reposts", 999_999)
            or eng.get("impressions", 0) >= abs_cfg.get("impressions", 9_999_999)
        )

        rel_cfg = cfg.get("relative", {})
        avg     = self._past_average(platform, n=rel_cfg.get("sample_size", 10))
        if avg:
            multiplier = rel_cfg.get("multiplier", 3.0)
            rel_passed = (
                eng.get("likes", 0)        >= avg["likes"] * multiplier
                or eng.get("impressions", 0) >= avg["impressions"] * multiplier
            )
        else:
            # 過去データなし(冷起動) → 絶対値のみで判定
            rel_passed = True

        triggered  = abs_passed and rel_passed
        elapsed    = eng.get("elapsed_min", 0)
        checkpoint = f"{elapsed}min"

        return BuzzSignal(
            post_id=post_id,
            platform=platform,
            checkpoint=checkpoint,
            likes=eng.get("likes", 0),
            reposts=reposts,
            impressions=eng.get("impressions", 0),
            triggered=triggered,
            reason=(
                f"abs={abs_passed} rel={rel_passed} "
                f"avg_likes={avg['likes'] if avg else 'N/A'}"
            ),
        )

    def _latest_engagements(self, post_id: str) -> Optional[dict]:
        """check_at_minutes 内の最新 engagement レコードを返す"""
        check_minutes: list[int] = self._cfg.get("check_at_minutes", [30, 180])
        rows = (
            self._supabase.table("engagements")
            .select("*")
            .eq("post_id", post_id)
            .in_("elapsed_min", check_minutes)
            .order("measured_at", desc=True)
            .limit(1)
            .execute()
        ).data
        return rows[0] if rows else None

    def _past_average(self, platform: str, n: int) -> Optional[dict]:
        """直近 N 件の published posts の 30min 時点 engagement 平均を返す"""
        # Step 1: 直近 N 件の posts を取得
        posts = (
            self._supabase.table("posts")
            .select("id")
            .eq("platform", platform)
            .eq("status", "published")
            .order("published_at", desc=True)
            .limit(n)
            .execute()
        ).data
        if not posts:
            return None

        post_ids = [p["id"] for p in posts]

        # Step 2: 30min 時点の engagement を取得
        engs = (
            self._supabase.table("engagements")
            .select("likes,impressions")
            .in_("post_id", post_ids)
            .eq("elapsed_min", 30)
            .execute()
        ).data
        if not engs:
            return None

        avg_likes = sum(e.get("likes", 0) for e in engs) / len(engs)
        avg_imp   = sum(e.get("impressions", 0) for e in engs) / len(engs)
        return {"likes": avg_likes, "impressions": avg_imp}

    def _is_in_cooldown(self, post_id: str) -> bool:
        """panic_log テーブルから cooldown 中かチェック"""
        cooldown_h = self._cfg.get("cooldown_hours", 6)
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=cooldown_h)).isoformat()
        rows = (
            self._supabase.table("panic_log")
            .select("id")
            .eq("post_id", post_id)
            .gte("triggered_at", cutoff)
            .execute()
        ).data
        return len(rows) > 0

    # ------------------------------------------------------------------
    async def generate_reply(self, signal: BuzzSignal) -> PanicReplyDraft:
        """バズシグナルを受けて、セルフリプライ案を Claude API で生成"""
        post = (
            self._supabase.table("posts")
            .select("*")
            .eq("id", signal.post_id)
            .single()
            .execute()
        ).data

        system   = self._build_panic_system_prompt(post, signal)
        user_msg = self._build_panic_user_prompt(post, signal)

        response = self._claude.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=400,
            system=system,
            messages=[{"role": "user", "content": user_msg}],
        )
        text = response.content[0].text.strip()

        return PanicReplyDraft(
            post_id=signal.post_id,
            parent_url=post.get("external_url"),
            text=text,
            char_count=len(text),
            rationale="バズ検知 → 動揺キャラのセルフリプライで畳みかけ",
        )

    def _build_panic_system_prompt(self, post: dict, signal: BuzzSignal) -> str:
        return (
            "あなたは shiwake-ai 公式の動揺キャラです。投稿がバズったので、"
            "ドタバタした調子で続編リプライを書きます。\n"
            "ルール:\n"
            "- 280字以内\n"
            "- 競合社名(freee/マネーフォワード/弥生)を出さない\n"
            "- 税法の具体数値・条文を新たに追加しない(元投稿の数値を引用するのはOK)\n"
            "- 元投稿の続きとして自然なリプライにする\n"
            "- ドタバタしたユーモアを込める(動揺・パニック感)\n"
            "- 末尾に「shiwake-ai」または製品リンクを入れる\n"
        )

    def _build_panic_user_prompt(self, post: dict, signal: BuzzSignal) -> str:
        return (
            f"元投稿:\n```\n{post['content']}\n```\n\n"
            f"バズ状況: {signal.checkpoint} 時点で "
            f"いいね{signal.likes} / リポスト{signal.reposts} / "
            f"インプレッション{signal.impressions}\n\n"
            "このバズに対するセルフリプライを動揺キャラ視点で書いてください。"
        )

    # ------------------------------------------------------------------
    async def notify_discord(self, draft: PanicReplyDraft, signal: BuzzSignal) -> None:
        """Discord に Panic 案を通知(承認待ち)"""
        from notify.discord import notify_panic
        notify_panic(draft, signal)

    def record_log(
        self,
        signal: BuzzSignal,
        draft: Optional[PanicReplyDraft],
    ) -> None:
        """panic_log テーブルに発火履歴を記録(cooldown 用)"""
        self._supabase.table("panic_log").insert({
            "post_id":      signal.post_id,
            "platform":     signal.platform,
            "checkpoint":   signal.checkpoint,
            "triggered_at": datetime.now(timezone.utc).isoformat(),
            "reason":       signal.reason,
        }).execute()


# ============================================================
# CLI
# ============================================================

async def _cmd_check(args: argparse.Namespace) -> None:
    node    = PanicNode()
    signals = await node.check_all_recent(hours=24)
    fired   = [s for s in signals if s.triggered]
    print(f"[panic] check完了: {len(signals)}件中 {len(fired)}件が発火条件を満たした")
    for sig in fired:
        draft = await node.generate_reply(sig)
        await node.notify_discord(draft, sig)
        node.record_log(sig, draft)
        print(f"  → post_id={sig.post_id}: '{draft.text[:30]}...' Discord通知済")


async def _cmd_generate(args: argparse.Namespace) -> None:
    """単発実行(post_id 指定で強制発動、テスト用)"""
    node = PanicNode()
    sig  = await node._check_one(args.post_id, args.platform)
    if not sig:
        print("[panic] engagementデータなし")
        return
    draft = await node.generate_reply(sig)
    print(f"[panic] 案: {draft.text}")
    print(f"[panic] {draft.char_count}字 / 理由: {draft.rationale}")


def main() -> None:
    p   = argparse.ArgumentParser(description="Panic ノード CLI")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("check", help="直近24時間の投稿を全件バズ判定")

    gen_p = sub.add_parser("generate", help="特定 post のリプ案生成(テスト用)")
    gen_p.add_argument("--post-id",  required=True)
    gen_p.add_argument("--platform", default="threads")

    args = p.parse_args()
    cmds = {"check": _cmd_check, "generate": _cmd_generate}
    asyncio.run(cmds[args.cmd](args))


if __name__ == "__main__":
    main()
