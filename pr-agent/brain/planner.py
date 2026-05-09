"""
T1-7: Planner ノード — 4軸コンボ自動選択

time_table.yaml の投稿スロットと Supabase の使用履歴・成功パターンから
最適な Persona × Character × Weapon × Trigger × Platform を決定する。

選択アルゴリズム:
  1. 現在時刻 ± 45min のスロットを time_table から探す
  2. Supabase posts から直近7日の使用コンボを取得
  3. Supabase success_patterns からスコアを取得
  4. 候補コンボをスコアリングして最上位を選択

CLI:
  uv run python -m brain.planner [--platform x] [--dry-run]
"""

import argparse
import asyncio
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from pydantic import BaseModel
from supabase import create_client, Client

from brain.trend_watcher import TrendWatcherNode
from brain.writer import WriterInput
from config.config_loader import (
    load_characters,
    load_time_table,
    load_triggers,
    load_weapons,
)

load_dotenv()

JST = ZoneInfo("Asia/Tokyo")

_SLOT_WINDOW_MIN = 45   # スロット時刻から ±45min 以内を「現在のスロット」とみなす
_RECENT_DAYS     = 7    # この日数以内の同一コンボ使用にペナルティ


# ============================================================
# I/O モデル
# ============================================================

class PlannerInput(BaseModel):
    now: datetime | None = None            # テスト用。None なら現在時刻 (JST)
    platform_override: str | None = None   # 強制指定（省略時は time_table 自動選択）
    dry_run: bool = False                  # True なら Supabase に書き込まない
    language: str = "ja"                  # "ja"（日本語）/ "en"（英語・P5-3）


class PlannerOutput(BaseModel):
    writer_input: WriterInput
    scheduled_at: datetime
    reasoning: str


# ============================================================
# スロット探索
# ============================================================

def _iter_slots(tt: dict) -> list[tuple[str, str, str]]:
    """time_table から (persona_id, platform, "HH:MM") の全スロットを返す"""
    # load_time_table() は {"time_table": {...}, "char_limits": {...}, ...} を返す
    persona_map = tt.get("time_table", tt)
    slots = []
    for persona_id, platforms in persona_map.items():
        if not isinstance(platforms, dict) or not persona_id.startswith("P"):
            continue
        for platform, times in platforms.items():
            if not isinstance(times, list):
                continue
            for t_str in times:
                slots.append((persona_id, platform, t_str))
    return slots


def _find_due_slots(now: datetime, platform_override: str | None) -> list[tuple[str, str, datetime]]:
    """現在時刻 ± _SLOT_WINDOW_MIN 以内のスロットを返す"""
    tt   = load_time_table()
    due  = []
    for persona_id, platform, t_str in _iter_slots(tt):
        if platform_override and platform != platform_override:
            continue
        h, m = map(int, t_str.split(":"))
        slot_dt = now.replace(hour=h, minute=m, second=0, microsecond=0)
        if abs((now - slot_dt).total_seconds() / 60) <= _SLOT_WINDOW_MIN:
            due.append((persona_id, platform, slot_dt))
    return due


def _find_next_slot(now: datetime, platform_override: str | None) -> tuple[str, str, datetime]:
    """最も近い未来スロットを返す（due が空の場合のフォールバック）"""
    tt = load_time_table()
    candidates = []
    for persona_id, platform, t_str in _iter_slots(tt):
        if platform_override and platform != platform_override:
            continue
        h, m = map(int, t_str.split(":"))
        slot_dt = now.replace(hour=h, minute=m, second=0, microsecond=0)
        if slot_dt <= now:
            slot_dt += timedelta(days=1)
        candidates.append((persona_id, platform, slot_dt))
    if not candidates:
        raise ValueError("time_table にスロットが見つかりません")
    return min(candidates, key=lambda x: x[2])


# ============================================================
# コンボ候補生成
# ============================================================

def _build_candidates(
    persona_id: str,
    platform: str,
    *,
    loose: bool = False,
) -> list[dict]:
    """
    (persona_id, platform) に適合する全 (character, weapon, trigger) 候補を返す。
    loose=True の場合は best_for_personas 制約を無視する。
    """
    chars    = load_characters()
    weapons  = load_weapons()
    triggers = load_triggers()
    results  = []

    for char_id, char in chars.items():
        if not loose and persona_id not in char.best_for_personas:
            continue
        for weapon_id in char.best_for_weapons:
            if weapon_id not in weapons:
                continue
            for trigger_id, trigger in triggers.items():
                if weapon_id not in trigger.suitable_weapons:
                    continue
                results.append({
                    "persona_id":   persona_id,
                    "character_id": char_id,
                    "weapon_id":    weapon_id,
                    "trigger_id":   trigger_id,
                    "platform":     platform,
                })
    return results


# ============================================================
# スコアリング
# ============================================================

def _score(
    combo: dict,
    recent: list[dict],
    patterns: list[dict],
) -> float:
    score = 0.0

    # 成功パターンにマッチ → win_rate × 10 を加点
    for p in patterns:
        if (
            p.get("weapon_id")    == combo["weapon_id"]
            and p.get("trigger_id")   == combo["trigger_id"]
            and p.get("persona_id")   == combo["persona_id"]
            and p.get("character_id") == combo["character_id"]
            and p.get("platform")     == combo["platform"]
        ):
            score += float(p.get("win_rate") or 0) * 10
            break

    # 最近使ったコンボ → 減点
    for r in recent:
        if (
            r.get("persona")      == combo["persona_id"]
            and r.get("character_id") == combo["character_id"]
            and r.get("weapon")       == combo["weapon_id"]
            and r.get("trigger_axis") == combo["trigger_id"]
        ):
            age = r.get("age_days", _RECENT_DAYS)
            score -= 10.0 if age <= 1 else (5.0 if age <= 3 else 2.0)

    return score


# ============================================================
# Planner ノード
# ============================================================

class PlannerNode:
    def __init__(self) -> None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        self._db: Client | None = create_client(url, key) if url and key else None

    def _recent_combos(self) -> list[dict]:
        if not self._db:
            return []
        try:
            cutoff = (datetime.now(timezone.utc) - timedelta(days=_RECENT_DAYS)).isoformat()
            rows = (
                self._db.table("posts")
                .select("persona, character_id, weapon, trigger_axis, created_at")
                .gte("created_at", cutoff)
                .in_("status", ["approved", "published", "awaiting_manual_post"])
                .execute()
            )
            result = []
            for row in rows.data or []:
                created = datetime.fromisoformat(row["created_at"].replace("Z", "+00:00"))
                age = (datetime.now(timezone.utc) - created).days
                result.append({**row, "age_days": age})
            return result
        except Exception:
            return []

    def _success_patterns(self) -> list[dict]:
        if not self._db:
            return []
        try:
            rows = (
                self._db.table("success_patterns")
                .select("persona_id,character_id,weapon_id,trigger_id,platform,win_rate,sample_count")
                .order("win_rate", desc=True)
                .limit(20)
                .execute()
            )
            return rows.data or []
        except Exception:
            return []

    async def run(self, inp: PlannerInput) -> PlannerOutput:
        now = (inp.now or datetime.now(JST)).astimezone(JST)

        # --- スロット選択 ---
        due = _find_due_slots(now, inp.platform_override)
        if due:
            persona_id, platform, scheduled_at = due[0]
            slot_source = "due"
        else:
            persona_id, platform, scheduled_at = _find_next_slot(now, inp.platform_override)
            slot_source = "next"

        # --- 候補生成 ---
        candidates = _build_candidates(persona_id, platform)
        if not candidates:
            candidates = _build_candidates(persona_id, platform, loose=True)
        if not candidates:
            raise ValueError(f"コンボ候補なし: persona={persona_id} platform={platform}")

        # --- Supabase から履歴 ---
        recent   = self._recent_combos()
        patterns = self._success_patterns()

        # --- スコアリング ---
        scored   = sorted(candidates, key=lambda c: _score(c, recent, patterns), reverse=True)
        selected = scored[0]

        # --- TrendWatcher: 直近24hの上位トレンドを context に注入 ---
        trend_context = ""
        trends: list[dict] = []
        try:
            trends = await TrendWatcherNode().get_top_for_planner(hours=24)
            if trends:
                lines = [f"・{t['title']}（{t['source_id']}）" for t in trends]
                trend_context = "最近の税務・経理トピック:\n" + "\n".join(lines)
        except Exception as e:
            print(f"[planner] TrendWatcher スキップ: {e}")

        # --- 理由文 ---
        reasoning = " | ".join(filter(None, [
            f"スロット({slot_source}): {persona_id}×{platform} @{scheduled_at.strftime('%H:%M')}JST",
            f"選択: {selected['character_id']} / {selected['weapon_id']} / {selected['trigger_id']}",
            f"候補{len(candidates)}件",
            f"直近{len(recent)}件参照" if recent else None,
            f"成功パターン{len(patterns)}件参照" if patterns else None,
            f"トレンド{len(trends)}件注入" if trend_context else None,
        ]))

        return PlannerOutput(
            writer_input=WriterInput(**selected, context=trend_context, language=inp.language),
            scheduled_at=scheduled_at,
            reasoning=reasoning,
        )


# ============================================================
# CLI
# ============================================================

async def _cli_main(args: argparse.Namespace) -> None:
    node   = PlannerNode()
    output = await node.run(PlannerInput(
        platform_override=args.platform or None,
        dry_run=args.dry_run,
        language=args.language,
    ))

    print(f"[planner] {output.reasoning}")
    print(f"[planner] scheduled_at : {output.scheduled_at.isoformat()}")
    wi = output.writer_input
    print(f"[planner] persona_id   : {wi.persona_id}")
    print(f"[planner] character_id : {wi.character_id}")
    print(f"[planner] weapon_id    : {wi.weapon_id}")
    print(f"[planner] trigger_id   : {wi.trigger_id}")
    print(f"[planner] platform     : {wi.platform}")


def main() -> None:
    parser = argparse.ArgumentParser(description="shiwake-ai Planner ノード CLI")
    parser.add_argument("--platform", choices=["x", "threads", "instagram", "note", "zenn"],
                        help="プラットフォームを強制指定")
    parser.add_argument("--language", default="ja", choices=["ja", "en"],
                        help="投稿言語: ja（日本語）/ en（英語）")
    parser.add_argument("--dry-run", action="store_true")
    asyncio.run(_cli_main(parser.parse_args()))


if __name__ == "__main__":
    main()
