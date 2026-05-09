"""
P2-2: MaterialScout ノード — 投稿用ビジュアル選定

visual_assets テーブルから weapon_compatibility / persona_fit でフィルタし、
最適な画像アセットを選定する。在庫なしなら cowork_needed=True を返す。

選定アルゴリズム:
  1. weapon_compatibility に weapon_id が含まれる資産を優先
  2. persona_fit に persona_id が含まれる資産をさらに加点
  3. masking_required=false / has_pii=false のみ対象
  4. use_count が少ない（使い回しを避ける）ほど高スコア
  5. Instagram は画像必須 → 在庫なしで cowork_needed=True

CLI:
  uv run python -m brain.material_scout --persona P1 --weapon W1 --platform threads
"""

import argparse
import asyncio
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from pydantic import BaseModel
from supabase import create_client, Client

load_dotenv()

_SUPABASE_URL        = os.getenv("SUPABASE_URL", "")
_SUPABASE_BUCKET     = os.getenv("SUPABASE_STORAGE_BUCKET", "visuals-bucket")
_COWORK_REQUESTS_DIR = Path(__file__).parent.parent / "dashboard" / "output" / "cowork_requests"
_JST                 = ZoneInfo("Asia/Tokyo")

# Instagram は画像必須プラットフォーム
_IMAGE_REQUIRED_PLATFORMS = {"instagram"}


# ============================================================
# I/O モデル
# ============================================================

class ScoutInput(BaseModel):
    persona_id: str          # P1–P4
    weapon_id:  str          # W1–W6
    platform:   str          # x / threads / instagram / note / zenn
    tags:       list[str] = []   # 追加タグフィルタ（任意）


class ScoutOutput(BaseModel):
    asset_id:         str | None = None
    storage_path:     str | None = None
    public_url:       str | None = None
    description:      str | None = None
    category:         str | None = None
    candidates_count: int = 0
    cowork_needed:    bool = False
    cowork_reason:    str = ""


# ============================================================
# スコアリング
# ============================================================

def _score_asset(asset: dict, inp: ScoutInput) -> float:
    score = 0.0

    # weapon_compatibility に weapon_id が含まれる → +3
    if inp.weapon_id in (asset.get("weapon_compatibility") or []):
        score += 3.0

    # persona_fit に persona_id が含まれる → +2
    if inp.persona_id in (asset.get("persona_fit") or []):
        score += 2.0

    # 追加タグが一致するごとに → +1
    asset_tags = set(asset.get("tags") or [])
    for tag in inp.tags:
        if tag in asset_tags:
            score += 1.0

    # use_count が少ないほど高得点（最大 -5 まで減点）
    use_count = asset.get("use_count") or 0
    score -= min(use_count * 0.5, 5.0)

    return score


# ============================================================
# Supabase URL 生成
# ============================================================

def _public_url(storage_path: str) -> str:
    return f"{_SUPABASE_URL}/storage/v1/object/public/{_SUPABASE_BUCKET}/{storage_path}"


# ============================================================
# P5-1: 画像生成依頼
# ============================================================

def _request_image_generation(inp: "ScoutInput") -> None:
    """在庫なし時に cowork_requests/ へ Adobe Firefly 生成依頼 JSON を書き出す"""
    from brain.image_prompt import build_prompt

    prompt_data = build_prompt(inp.weapon_id, inp.persona_id, inp.platform)
    now_jst     = datetime.now(_JST)
    filename    = f"{now_jst.strftime('%Y-%m-%d_%H%M%S')}_image_generate.json"

    _COWORK_REQUESTS_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "instruction": "image_generate",
        "params": {
            "weapon_id":            inp.weapon_id,
            "persona_id":           inp.persona_id,
            "platform":             inp.platform,
            "firefly_prompt":       prompt_data["firefly_prompt"],
            "negative_prompt":      prompt_data["negative_prompt"],
            "aspect_ratio":         prompt_data["aspect_ratio"],
            "weapon_compatibility": [inp.weapon_id],
            "persona_fit":          [inp.persona_id],
            "tags":                 inp.tags + [inp.weapon_id, inp.persona_id, inp.platform],
            "category":             "generated",
        },
        "requested_at": now_jst.isoformat(),
        "requested_by": "material_scout",
        "status":       "pending",
    }
    path = _COWORK_REQUESTS_DIR / filename
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[scout] 📸 画像生成依頼を作成: {path.name}")


# ============================================================
# MaterialScout ノード
# ============================================================

class MaterialScoutNode:
    def __init__(self) -> None:
        url = os.getenv("SUPABASE_URL", "")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
        self._db: Client | None = create_client(url, key) if url and key else None

    async def run(self, inp: ScoutInput) -> ScoutOutput:
        if not self._db:
            raise RuntimeError("Supabase 未接続")

        # --- weapon または persona で候補を取得 ---
        # weapon_compatibility 一致を優先取得
        by_weapon = (
            self._db.table("visual_assets")
            .select("*")
            .contains("weapon_compatibility", [inp.weapon_id])
            .eq("masking_required", False)
            .eq("has_pii", False)
            .execute()
        )

        # persona_fit 一致も取得（weapon と重複する可能性あり）
        by_persona = (
            self._db.table("visual_assets")
            .select("*")
            .contains("persona_fit", [inp.persona_id])
            .eq("masking_required", False)
            .eq("has_pii", False)
            .execute()
        )

        # 重複排除してマージ
        seen: set[str] = set()
        candidates: list[dict] = []
        for asset in (by_weapon.data or []) + (by_persona.data or []):
            if asset["id"] not in seen:
                seen.add(asset["id"])
                candidates.append(asset)

        # --- 在庫なし処理 ---
        if not candidates:
            reason = (
                f"weapon={inp.weapon_id} / persona={inp.persona_id} に対応する"
                "マスキング不要な画像アセットが見つかりません。"
            )
            # P5-1: 自動で Cowork に画像生成依頼を書き出す
            _request_image_generation(inp)
            return ScoutOutput(
                cowork_needed=True,
                cowork_reason=reason,
                candidates_count=0,
            )

        # --- スコアリング ---
        scored = sorted(candidates, key=lambda a: _score_asset(a, inp), reverse=True)
        best   = scored[0]

        # --- use_count / last_used_at 更新 ---
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: (
            self._db.table("visual_assets")
            .update({
                "use_count":    (best.get("use_count") or 0) + 1,
                "last_used_at": datetime.now(timezone.utc).isoformat(),
            })
            .eq("id", best["id"])
            .execute()
        ))

        return ScoutOutput(
            asset_id=best["id"],
            storage_path=best["storage_path"],
            public_url=_public_url(best["storage_path"]),
            description=best.get("description"),
            category=best.get("category"),
            candidates_count=len(candidates),
        )


# ============================================================
# CLI
# ============================================================

async def _cli_main(args: argparse.Namespace) -> None:
    node   = MaterialScoutNode()
    inp    = ScoutInput(
        persona_id=args.persona,
        weapon_id=args.weapon,
        platform=args.platform,
    )
    output = await node.run(inp)

    if output.cowork_needed:
        print(f"[scout] ⚠️  Cowork 必要: {output.cowork_reason}")
        return

    print(f"[scout] ✅ 候補 {output.candidates_count} 件 → 選定:")
    print(f"  asset_id    : {output.asset_id}")
    print(f"  category    : {output.category}")
    print(f"  description : {output.description}")
    print(f"  public_url  : {output.public_url}")


def main() -> None:
    parser = argparse.ArgumentParser(description="shiwake-ai MaterialScout ノード CLI")
    parser.add_argument("--persona",  required=True, choices=["P1", "P2", "P3", "P4"])
    parser.add_argument("--weapon",   required=True, choices=["W1", "W2", "W3", "W4", "W5", "W6"])
    parser.add_argument("--platform", required=True,
                        choices=["x", "threads", "instagram", "note", "zenn"])
    asyncio.run(_cli_main(parser.parse_args()))


if __name__ == "__main__":
    main()
