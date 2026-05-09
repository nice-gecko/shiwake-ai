"""
T1-9: Pipeline — Planner → Writer → Publisher 統合

2つのモード:
  generate  : Planner + Writer で3案生成 → Supabase に 'draft' 保存
  publish   : 承認済み post_id を受け取り Publisher で投稿
  run-auto  : generate → 案A を自動選択 → publish (テスト・cron 用)

CLI:
  uv run python -m brain.pipeline generate [--platform x]
  uv run python -m brain.pipeline publish  --post-id <uuid>
  uv run python -m brain.pipeline run-auto [--platform x]
"""

import argparse
import asyncio
import os
from datetime import timezone

from dotenv import load_dotenv
from pydantic import BaseModel
from supabase import create_client, Client

from brain.planner        import PlannerNode, PlannerInput, PlannerOutput
from brain.writer         import WriterNode, DraftPost, WriterOutput
from brain.publisher      import PublisherNode, PublisherInput, PublisherOutput
from brain.material_scout import MaterialScoutNode, ScoutInput, ScoutOutput
from notify.discord       import notify_drafts, notify_published, notify_error

load_dotenv()


# ============================================================
# I/O モデル
# ============================================================

class GenerateOutput(BaseModel):
    plan:     PlannerOutput
    drafts:   list[DraftPost]
    post_ids: list[str]          # Supabase posts.id (3件、ドラフト順)
    model_used:           str
    usage_input_tokens:   int
    usage_output_tokens:  int


class PipelineRunOutput(BaseModel):
    generate: GenerateOutput
    published: PublisherOutput


# ============================================================
# Supabase ドラフト保存
# ============================================================

def _save_draft(
    db: Client,
    plan: PlannerOutput,
    draft: DraftPost,
    visual_asset_id: str | None = None,
) -> str:
    """posts テーブルに draft を INSERT し post_id を返す"""
    row: dict = {
        "platform":     draft.platform,
        "persona":      draft.persona_id,
        "character_id": draft.character_id,
        "weapon":       draft.weapon_id,
        "trigger_axis": draft.trigger_id,
        "content":      draft.body,
        "status":       "draft",
        "scheduled_at": plan.scheduled_at.astimezone(timezone.utc).isoformat(),
        "parameters":   {
            "angle":      draft.angle,
            "char_count": draft.char_count,
            "over_limit": draft.over_limit,
        },
    }
    if visual_asset_id:
        row["media_asset_ids"] = [visual_asset_id]
    result = db.table("posts").insert(row).execute()
    return result.data[0]["id"]


def _fetch_approved_post(db: Client, post_id: str) -> dict:
    """承認済み投稿を Supabase から取得する"""
    rows = (
        db.table("posts")
        .select("*")
        .eq("id", post_id)
        .execute()
    )
    if not rows.data:
        raise ValueError(f"posts に post_id={post_id} が見つかりません")
    post = rows.data[0]
    if post["status"] not in ("approved", "draft"):
        raise ValueError(f"投稿 status={post['status']} は publish 対象外です")
    return post


# ============================================================
# Pipeline
# ============================================================

class Pipeline:
    def __init__(self) -> None:
        self._planner   = PlannerNode()
        self._writer    = WriterNode()
        self._publisher = PublisherNode()
        self._scout     = MaterialScoutNode()

        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        self._db: Client | None = create_client(url, key) if url and key else None

    def _check_auto_publish(self, platform: str) -> bool:
        """automation_settings から auto_publish フラグを返す。DB 未接続や例外時は False"""
        if not self._db:
            return False
        try:
            result = (
                self._db.table("automation_settings")
                .select("auto_publish")
                .eq("platform", platform)
                .single()
                .execute()
            )
            return bool(result.data and result.data.get("auto_publish", False))
        except Exception:
            return False

    # ------------------------------------------------------------------
    async def generate(self, planner_inp: PlannerInput) -> GenerateOutput:
        """Planner → Writer → Supabase draft 保存"""

        # 1. Planner: 4軸コンボ決定
        plan = await self._planner.run(planner_inp)
        print(f"[pipeline] Planner: {plan.reasoning}")

        # 2. MaterialScout: ビジュアル選定
        scout: ScoutOutput = await self._scout.run(ScoutInput(
            persona_id=plan.writer_input.persona_id,
            weapon_id=plan.writer_input.weapon_id,
            platform=plan.writer_input.platform,
        ))
        if scout.cowork_needed:
            print(f"[pipeline] Scout: ⚠️  Cowork 必要 — {scout.cowork_reason}")
        else:
            print(f"[pipeline] Scout: ✅ {scout.category} / {scout.description[:40] if scout.description else '—'}")

        # ビジュアル説明を Writer に注入（在庫ありの場合のみ）
        writer_input = plan.writer_input.model_copy(
            update={"visual_description": scout.description or ""}
        )

        # 3. Writer: 3案生成
        print("[pipeline] Writer: 生成中...")
        writer_out: WriterOutput = await self._writer.run(writer_input)
        print(f"[pipeline] Writer: {len(writer_out.drafts)}案生成完了"
              f" (in={writer_out.usage_input_tokens} out={writer_out.usage_output_tokens} tokens)")

        # 4. Supabase に保存
        post_ids: list[str] = []
        if self._db:
            for draft in writer_out.drafts:
                pid = _save_draft(self._db, plan, draft, scout.asset_id)
                post_ids.append(pid)
                print(f"[pipeline] saved draft {draft.angle}: {pid}")
        else:
            post_ids = ["dry-run-A", "dry-run-B", "dry-run-C"]

        gen = GenerateOutput(
            plan=plan,
            drafts=writer_out.drafts,
            post_ids=post_ids,
            model_used=writer_out.model_used,
            usage_input_tokens=writer_out.usage_input_tokens,
            usage_output_tokens=writer_out.usage_output_tokens,
        )

        # 5. 自動化解禁チェック → ON なら案A を即投稿、OFF なら Discord 通知
        platform = plan.writer_input.platform
        if post_ids[0] != "dry-run-A" and self._check_auto_publish(platform):
            print(f"[pipeline] auto_publish=ON ({platform}): 案A を自動投稿")
            if self._db:
                self._db.table("posts").update({"status": "approved"}).eq("id", post_ids[0]).execute()
            pub = await self.publish(post_ids[0])
            print(f"[pipeline] auto-published: status={pub.status}")
        else:
            notify_drafts(gen.drafts, gen.post_ids, plan.scheduled_at)

        return gen

    # ------------------------------------------------------------------
    async def publish(self, post_id: str) -> PublisherOutput:
        """承認済み post_id を受け取り Publisher で投稿"""
        if not self._db:
            raise RuntimeError("Supabase 未接続: SUPABASE_URL / KEY を確認してください")

        post = _fetch_approved_post(self._db, post_id)

        # media_asset_ids から storage_path を逆引き
        visual_storage_path: str | None = None
        asset_ids = post.get("media_asset_ids") or []
        if asset_ids:
            va = (
                self._db.table("visual_assets")
                .select("storage_path")
                .eq("id", asset_ids[0])
                .execute()
            )
            if va.data:
                visual_storage_path = va.data[0]["storage_path"]

        inp = PublisherInput(
            content=post["content"],
            platform=post["platform"],
            persona_id=post["persona"],
            character_id=post["character_id"],
            weapon_id=post["weapon"],
            trigger_id=post["trigger_axis"] or "altruism",
            post_id=post_id,
            visual_asset_id=asset_ids[0] if asset_ids else None,
            visual_storage_path=visual_storage_path,
        )
        out = await self._publisher.run(inp)
        print(f"[pipeline] Publisher: status={out.status}"
              + (f" url={out.external_url}" if out.external_url else ""))

        # Discord に投稿結果通知
        notify_published(
            post_id=out.post_id,
            platform=out.platform,
            status=out.status,
            external_url=out.external_url,
            message=out.message,
        )

        return out

    # ------------------------------------------------------------------
    async def run_auto(self, planner_inp: PlannerInput) -> PipelineRunOutput:
        """generate → 案A を自動選択 → publish（テスト・cron 用）"""
        try:
            gen = await self.generate(planner_inp)

            # 案A (index 0) を自動選択
            selected_id = gen.post_ids[0]

            # status を 'approved' に変更してから publish
            if self._db and selected_id != "dry-run-A":
                self._db.table("posts").update({"status": "approved"}).eq("id", selected_id).execute()

            pub = await self.publish(selected_id)
            return PipelineRunOutput(generate=gen, published=pub)

        except Exception as e:
            notify_error(e, context="Pipeline.run_auto")
            raise


# ============================================================
# CLI
# ============================================================

def _print_drafts(gen: GenerateOutput) -> None:
    from config.config_loader import load_time_table
    tt = load_time_table()
    char_limits = tt.get("char_limits", {})
    platform    = gen.drafts[0].platform if gen.drafts else "?"
    limit       = char_limits.get(platform)

    print(f"\n── スロット: {gen.plan.scheduled_at.strftime('%Y-%m-%d %H:%M')} JST"
          f" | {gen.plan.writer_input.persona_id} × {platform} ──")
    print(f"   {gen.plan.reasoning}\n")

    for draft, pid in zip(gen.drafts, gen.post_ids):
        limit_str = f"/{limit}" if limit else ""
        over      = " ⚠️ over limit" if draft.over_limit else ""
        print(f"▶ 案{draft.angle}  [{draft.char_count}{limit_str}字{over}]  post_id={pid}")
        print(draft.body)
        print()

    print(f"model={gen.model_used}  "
          f"tokens: in={gen.usage_input_tokens} out={gen.usage_output_tokens}")


async def _cmd_generate(args: argparse.Namespace) -> None:
    pipeline = Pipeline()
    gen = await pipeline.generate(PlannerInput(
        platform_override=args.platform or None,
        language=args.language,
    ))
    _print_drafts(gen)


async def _cmd_publish(args: argparse.Namespace) -> None:
    pipeline = Pipeline()
    out = await pipeline.publish(args.post_id)
    print(f"[pipeline] post_id={out.post_id}  status={out.status}")
    if out.external_url:
        print(f"[pipeline] url={out.external_url}")
    print(f"[pipeline] {out.message}")


async def _cmd_run_auto(args: argparse.Namespace) -> None:
    pipeline = Pipeline()
    result   = await pipeline.run_auto(PlannerInput(
        platform_override=args.platform or None,
        language=args.language,
    ))
    _print_drafts(result.generate)
    print(f"\n[pipeline] auto-published: status={result.published.status}")
    if result.published.external_url:
        print(f"[pipeline] url={result.published.external_url}")


def main() -> None:
    parser = argparse.ArgumentParser(description="shiwake-ai Pipeline CLI")
    sub    = parser.add_subparsers(dest="cmd", required=True)

    gen_p = sub.add_parser("generate", help="Planner+Writer で3案生成")
    gen_p.add_argument("--platform", choices=["x", "threads", "instagram", "note", "zenn"])
    gen_p.add_argument("--language", default="ja", choices=["ja", "en"])

    pub_p = sub.add_parser("publish", help="承認済み post_id を投稿")
    pub_p.add_argument("--post-id", required=True)

    auto_p = sub.add_parser("run-auto", help="generate→案A自動選択→publish")
    auto_p.add_argument("--platform", choices=["x", "threads", "instagram", "note", "zenn"])
    auto_p.add_argument("--language", default="ja", choices=["ja", "en"])

    args = parser.parse_args()
    cmds = {"generate": _cmd_generate, "publish": _cmd_publish, "run-auto": _cmd_run_auto}
    asyncio.run(cmds[args.cmd](args))


if __name__ == "__main__":
    main()
