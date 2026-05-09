"""
T1-8: Publisher ノード — プラットフォーム別投稿 + Supabase 書き込み

ルーティング:
  x         → posts.status = 'awaiting_manual_post'  (patch_001: API不使用)
  threads   → Threads API (2ステップ: create → publish)
  instagram → Instagram Graph API (container → publish、画像必須)
  note/zenn → posts.status = 'awaiting_manual_post'  (公式 API なし)

CLI:
  uv run python -m brain.publisher --platform threads --content "テスト投稿" \
    --persona P1 --character shoyo_kun --weapon W1 --trigger antagonism
"""

import argparse
import asyncio
import os
from datetime import datetime, timezone
from typing import Literal

import httpx
from dotenv import load_dotenv
from pydantic import BaseModel
from supabase import create_client, Client

load_dotenv()

_THREADS_BASE = "https://graph.threads.net/v1.0"
_IG_BASE      = "https://graph.facebook.com/v19.0"

# 手動投稿扱いにするプラットフォーム（API 未実装 or patch_001 対象）
_MANUAL_PLATFORMS = {"x", "note", "zenn"}

PostStatus = Literal["draft", "approved", "awaiting_manual_post", "published", "rejected"]


# ============================================================
# I/O モデル
# ============================================================

class PublisherInput(BaseModel):
    content: str
    platform: str
    persona_id: str
    character_id: str
    weapon_id: str
    trigger_id: str
    scheduled_at: datetime | None = None
    visual_asset_id: str | None = None    # visual_assets.id（Instagram 必須）
    visual_storage_path: str | None = None  # Supabase Storage パス（Instagram 用）
    post_id: str | None = None            # 既存 posts.id（省略時は新規 INSERT）


class PublisherOutput(BaseModel):
    post_id: str
    status: PostStatus
    platform: str
    external_id: str | None = None
    external_url: str | None = None
    message: str = ""


# ============================================================
# Supabase ヘルパー
# ============================================================

def _upsert_post(db: Client, inp: PublisherInput, status: PostStatus) -> str:
    """posts テーブルに INSERT し、post_id を返す"""
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "platform":     inp.platform,
        "persona":      inp.persona_id,
        "character_id": inp.character_id,
        "weapon":       inp.weapon_id,
        "trigger_axis": inp.trigger_id,
        "content":      inp.content,
        "status":       status,
        "scheduled_at": inp.scheduled_at.isoformat() if inp.scheduled_at else now,
    }
    if inp.visual_asset_id:
        row["media_asset_ids"] = [inp.visual_asset_id]

    result = db.table("posts").insert(row).execute()
    return result.data[0]["id"]


def _update_post(
    db: Client,
    post_id: str,
    status: PostStatus,
    *,
    external_id: str | None = None,
    external_url: str | None = None,
    published_at: str | None = None,
) -> None:
    patch: dict = {"status": status}
    if external_id:
        patch["external_id"] = external_id
    if external_url:
        patch["external_url"] = external_url
    if published_at:
        patch["published_at"] = published_at
    db.table("posts").update(patch).eq("id", post_id).execute()


# ============================================================
# Threads 投稿
# ============================================================

async def _publish_threads(content: str, client: httpx.AsyncClient) -> tuple[str, str]:
    """
    Threads API で投稿し (external_id, external_url) を返す。
    2ステップ: create container → publish
    """
    user_id = os.environ["THREADS_USER_ID"]
    token   = os.environ["THREADS_ACCESS_TOKEN"]

    # Step 1: コンテナ作成
    create_resp = await client.post(
        f"{_THREADS_BASE}/{user_id}/threads",
        params={
            "media_type":   "TEXT",
            "text":         content,
            "access_token": token,
        },
    )
    create_resp.raise_for_status()
    creation_id = create_resp.json()["id"]

    # Step 2: 公開
    publish_resp = await client.post(
        f"{_THREADS_BASE}/{user_id}/threads_publish",
        params={
            "creation_id":  creation_id,
            "access_token": token,
        },
    )
    publish_resp.raise_for_status()
    thread_id = publish_resp.json()["id"]

    external_url = f"https://www.threads.net/@{user_id}/post/{thread_id}"
    return thread_id, external_url


# ============================================================
# Instagram 投稿
# ============================================================

async def _publish_instagram(
    content: str,
    image_url: str,
    client: httpx.AsyncClient,
) -> tuple[str, str]:
    """
    Instagram Graph API で画像投稿し (external_id, external_url) を返す。
    2ステップ: media container → publish
    """
    ig_id = os.environ["IG_BUSINESS_ACCOUNT_ID"]
    token = os.environ["IG_ACCESS_TOKEN"]

    # Step 1: メディアコンテナ作成
    container_resp = await client.post(
        f"{_IG_BASE}/{ig_id}/media",
        params={
            "image_url":    image_url,
            "caption":      content,
            "access_token": token,
        },
    )
    container_resp.raise_for_status()
    creation_id = container_resp.json()["id"]

    # Step 2: 公開
    publish_resp = await client.post(
        f"{_IG_BASE}/{ig_id}/media_publish",
        params={
            "creation_id":  creation_id,
            "access_token": token,
        },
    )
    publish_resp.raise_for_status()
    media_id = publish_resp.json()["id"]

    external_url = f"https://www.instagram.com/p/{media_id}/"
    return media_id, external_url


# ============================================================
# Publisher ノード
# ============================================================

class PublisherNode:
    def __init__(self) -> None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        self._db: Client | None = create_client(url, key) if url and key else None

    async def run(self, inp: PublisherInput) -> PublisherOutput:
        platform = inp.platform

        # --- Supabase に posts レコードを INSERT ---
        if self._db:
            post_id = inp.post_id or _upsert_post(self._db, inp, "draft")
        else:
            post_id = "dry-run"

        # --- プラットフォーム別ルーティング ---
        if platform in _MANUAL_PLATFORMS:
            return await self._manual(inp, post_id, platform)
        elif platform == "threads":
            return await self._threads(inp, post_id)
        elif platform == "instagram":
            return await self._instagram(inp, post_id)
        else:
            raise ValueError(f"未対応のプラットフォーム: {platform}")

    # ------------------------------------------------------------------
    async def _manual(self, inp: PublisherInput, post_id: str, platform: str) -> PublisherOutput:
        """X / note / zenn: 手動投稿ステータスに設定"""
        if self._db:
            _update_post(self._db, post_id, "awaiting_manual_post")
        reason = {
            "x":    "patch_001: X API 不使用のため手動投稿",
            "note": "note 公式 API なし",
            "zenn": "zenn 公式 API なし",
        }.get(platform, "手動投稿")
        return PublisherOutput(
            post_id=post_id,
            status="awaiting_manual_post",
            platform=platform,
            message=reason,
        )

    # ------------------------------------------------------------------
    async def _threads(self, inp: PublisherInput, post_id: str) -> PublisherOutput:
        _require_env("THREADS_USER_ID", "THREADS_ACCESS_TOKEN")
        async with httpx.AsyncClient(timeout=30.0) as client:
            external_id, external_url = await _publish_threads(inp.content, client)

        now_iso = datetime.now(timezone.utc).isoformat()
        if self._db:
            _update_post(
                self._db, post_id, "published",
                external_id=external_id,
                external_url=external_url,
                published_at=now_iso,
            )
        return PublisherOutput(
            post_id=post_id,
            status="published",
            platform="threads",
            external_id=external_id,
            external_url=external_url,
            message="Threads 投稿完了",
        )

    # ------------------------------------------------------------------
    async def _instagram(self, inp: PublisherInput, post_id: str) -> PublisherOutput:
        # Instagram は画像必須。storage_path がなければ手動扱い
        if not inp.visual_storage_path:
            if self._db:
                _update_post(self._db, post_id, "awaiting_manual_post")
            return PublisherOutput(
                post_id=post_id,
                status="awaiting_manual_post",
                platform="instagram",
                message="Instagram: 画像なしのため手動投稿待ち",
            )

        _require_env("IG_BUSINESS_ACCOUNT_ID", "IG_ACCESS_TOKEN")
        image_url = _storage_public_url(inp.visual_storage_path)

        async with httpx.AsyncClient(timeout=30.0) as client:
            external_id, external_url = await _publish_instagram(
                inp.content, image_url, client
            )

        now_iso = datetime.now(timezone.utc).isoformat()
        if self._db:
            _update_post(
                self._db, post_id, "published",
                external_id=external_id,
                external_url=external_url,
                published_at=now_iso,
            )
        return PublisherOutput(
            post_id=post_id,
            status="published",
            platform="instagram",
            external_id=external_id,
            external_url=external_url,
            message="Instagram 投稿完了",
        )


# ============================================================
# ヘルパー
# ============================================================

def _require_env(*keys: str) -> None:
    missing = [k for k in keys if not os.getenv(k)]
    if missing:
        raise EnvironmentError(f"環境変数が未設定です: {', '.join(missing)}")


def _storage_public_url(storage_path: str) -> str:
    """Supabase Storage の公開 URL を生成する"""
    url    = os.environ["SUPABASE_URL"]
    bucket = os.getenv("SUPABASE_STORAGE_BUCKET", "visuals-bucket")
    return f"{url}/storage/v1/object/public/{bucket}/{storage_path}"


# ============================================================
# CLI
# ============================================================

async def _cli_main(args: argparse.Namespace) -> None:
    node = PublisherNode()
    inp  = PublisherInput(
        content=args.content,
        platform=args.platform,
        persona_id=args.persona,
        character_id=args.character,
        weapon_id=args.weapon,
        trigger_id=args.trigger,
    )
    print(f"[publisher] platform={args.platform} | content={args.content[:40]}...")
    output = await node.run(inp)
    print(f"[publisher] post_id={output.post_id}")
    print(f"[publisher] status={output.status}")
    if output.external_url:
        print(f"[publisher] url={output.external_url}")
    print(f"[publisher] {output.message}")


def main() -> None:
    parser = argparse.ArgumentParser(description="shiwake-ai Publisher ノード CLI")
    parser.add_argument("--platform",  required=True,
                        choices=["x", "threads", "instagram", "note", "zenn"])
    parser.add_argument("--content",   required=True)
    parser.add_argument("--persona",   default="P1")
    parser.add_argument("--character", default="shoyo_kun")
    parser.add_argument("--weapon",    default="W1")
    parser.add_argument("--trigger",   default="antagonism")
    asyncio.run(_cli_main(parser.parse_args()))


if __name__ == "__main__":
    main()
