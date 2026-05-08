"""
T1-4: 12枚の手動UIスクショを Supabase Storage にアップロードし
visual_assets テーブルに登録するスクリプト。

使い方:
  1. pr-agent/visuals/raw/ に 001_*.png 〜 012_*.png を置く
  2. .env に SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_STORAGE_BUCKET を設定
  3. uv run python -m visuals.upload_assets

冪等設計: storage_path が既に visual_assets に存在する場合はスキップ。
"""

import asyncio
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client, Client
import os

load_dotenv()

RAW_DIR = Path(__file__).parent / "raw"
BUCKET = os.getenv("SUPABASE_STORAGE_BUCKET", "visuals-bucket")
STORAGE_PREFIX = "raw/manual"

# ============================================================
# 12枚の画像メタデータ定義
# ============================================================
ASSET_CATALOG: list[dict] = [
    {
        "index": 1,
        "category": "scan",
        "tags": ["toC", "scan", "upload"],
        "weapon_compatibility": ["W1", "W2"],
        "persona_fit": ["P1", "P2"],
        "description": "スキャン画面 — カメラ撮影/画像アップロードのUI",
        "has_pii": False,
        "masking_required": False,
    },
    {
        "index": 2,
        "category": "dashboard",
        "tags": ["csv", "export", "approval"],
        "weapon_compatibility": ["W2"],
        "persona_fit": ["P1", "P2", "P3"],
        "description": "CSV出力画面 — 承認済み仕訳のエクスポートボタン",
        "has_pii": False,
        "masking_required": False,
    },
    {
        "index": 3,
        "category": "card",
        "tags": ["judgment-visible", "trust-badge", "approved"],
        "weapon_compatibility": ["W3", "W1"],
        "persona_fit": ["P1", "P3", "P4"],
        "description": "仕訳カード — 高信頼・適格インボイスバッジ付き",
        "has_pii": False,
        "masking_required": False,
    },
    {
        "index": 4,
        "category": "pricing",
        "tags": ["pricing", "agent_plan"],
        "weapon_compatibility": ["W2"],
        "persona_fit": ["P3", "P4"],
        "description": "Agentプラン価格ページ（価格部分は要マスキング）",
        "has_pii": True,
        "masking_required": True,
    },
    {
        "index": 5,
        "category": "dashboard",
        "tags": ["approval", "list", "judgment-visible"],
        "weapon_compatibility": ["W1", "W2"],
        "persona_fit": ["P1", "P2"],
        "description": "仕訳一覧 — 承認前後の状態比較",
        "has_pii": False,
        "masking_required": False,
    },
    {
        "index": 6,
        "category": "card",
        "tags": ["judgment-visible", "ai-reason", "transparency"],
        "weapon_compatibility": ["W3", "W4"],
        "persona_fit": ["P3", "P4"],
        "description": "仕訳詳細 — AIが判断した根拠・勘定科目の理由が見える画面",
        "has_pii": False,
        "masking_required": False,
    },
    {
        "index": 7,
        "category": "scan",
        "tags": ["ocr", "scan-result", "accuracy"],
        "weapon_compatibility": ["W1", "W3"],
        "persona_fit": ["P1", "P2"],
        "description": "OCR読み取り結果 — スキャン後の文字認識結果画面",
        "has_pii": False,
        "masking_required": False,
    },
    {
        "index": 8,
        "category": "dashboard",
        "tags": ["category-rule", "settings", "customization"],
        "weapon_compatibility": ["W3"],
        "persona_fit": ["P3", "P4"],
        "description": "カテゴリルール設定画面",
        "has_pii": False,
        "masking_required": False,
    },
    {
        "index": 9,
        "category": "dashboard",
        "tags": ["master_list", "vendor_names", "learning"],
        "weapon_compatibility": ["W3", "W2"],
        "persona_fit": ["P3", "P4"],
        "description": "取引先マスタ — 13社以上登録済み（店名は要マスキング）",
        "has_pii": True,
        "masking_required": True,
    },
    {
        "index": 10,
        "category": "scan",
        "tags": ["toC", "scan", "mobile"],
        "weapon_compatibility": ["W1", "W5"],
        "persona_fit": ["P1"],
        "description": "スキャン画面（モバイルビュー） — スマホ操作感を訴求",
        "has_pii": False,
        "masking_required": False,
    },
    {
        "index": 11,
        "category": "dashboard",
        "tags": ["dashboard", "incentive", "stats", "gamification"],
        "weapon_compatibility": ["W2", "W4"],
        "persona_fit": ["P2", "P1"],
        "description": "ダッシュボード — 処理91枚+、インセンティブ79枚+、マスタ13社+",
        "has_pii": False,
        "masking_required": False,
    },
    {
        "index": 12,
        "category": "dashboard",
        "tags": ["dashboard", "overview", "toC"],
        "weapon_compatibility": ["W1", "W2", "W4"],
        "persona_fit": ["P1", "P2", "P3"],
        "description": "ダッシュボード全体 — shiwake-aiの全機能俯瞰",
        "has_pii": False,
        "masking_required": False,
    },
]


def _find_file(index: int) -> Path | None:
    """001_*.png 形式でファイルを探す"""
    prefix = f"{index:03d}_"
    matches = list(RAW_DIR.glob(f"{prefix}*.png")) + list(RAW_DIR.glob(f"{prefix}*.jpg"))
    return matches[0] if matches else None


def _storage_path(index: int, filename: str) -> str:
    return f"{STORAGE_PREFIX}/{index:03d}_{Path(filename).stem}.png"


async def upload_all(supabase: Client) -> None:
    print(f"[upload_assets] RAW_DIR: {RAW_DIR}")
    print(f"[upload_assets] BUCKET : {BUCKET}\n")

    missing = []
    for meta in ASSET_CATALOG:
        idx = meta["index"]
        file_path = _find_file(idx)
        if not file_path:
            missing.append(f"  {idx:03d}_*.png")

    if missing:
        print("以下のファイルが見つかりません:")
        for m in missing:
            print(m)
        print("\npr-agent/visuals/raw/ に配置してから再実行してください。")
        sys.exit(1)

    for meta in ASSET_CATALOG:
        idx = meta["index"]
        file_path = _find_file(idx)
        storage_path = _storage_path(idx, file_path.name)

        # 既登録チェック（冪等）
        existing = (
            supabase.table("visual_assets")
            .select("id")
            .eq("storage_path", storage_path)
            .execute()
        )
        if existing.data:
            print(f"  [{idx:02d}] SKIP (already registered): {storage_path}")
            continue

        # Storage にアップロード
        with open(file_path, "rb") as f:
            supabase.storage.from_(BUCKET).upload(
                path=storage_path,
                file=f,
                file_options={"content-type": "image/png", "upsert": "true"},
            )

        # visual_assets に登録
        supabase.table("visual_assets").insert(
            {
                "storage_path": storage_path,
                "source": "manual",
                "category": meta["category"],
                "tags": meta["tags"],
                "weapon_compatibility": meta["weapon_compatibility"],
                "persona_fit": meta["persona_fit"],
                "description": meta["description"],
                "has_pii": meta["has_pii"],
                "masking_required": meta["masking_required"],
            }
        ).execute()

        pii_mark = " ⚠️ PII" if meta["has_pii"] else ""
        print(f"  [{idx:02d}] OK  {storage_path}{pii_mark}")

    print("\n[upload_assets] 完了。")


def main() -> None:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("ERROR: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が .env に設定されていません。")
        sys.exit(1)

    supabase: Client = create_client(url, key)
    asyncio.run(upload_all(supabase))


if __name__ == "__main__":
    main()
