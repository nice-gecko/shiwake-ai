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

RAW_DIR = Path(__file__).parent / "raw" / "manual"
BUCKET = os.getenv("SUPABASE_STORAGE_BUCKET", "visuals-bucket")
STORAGE_PREFIX = "raw/manual"

# ============================================================
# 12枚の画像メタデータ定義
# ============================================================
ASSET_CATALOG: list[dict] = [
    {
        "index": 1,
        "category": "scan",
        "tags": ["toC", "scan", "mobile", "smartphone"],
        "weapon_compatibility": ["W1", "W5"],
        "persona_fit": ["P1"],
        "description": "スマホ画面 — 「スマホで開くと高性能スキャナーになります」フキダシ付き",
        "has_pii": False,
        "masking_required": False,
    },
    {
        "index": 2,
        "category": "dashboard",
        # 競合社名（弥生会計・freee・マネフォ）が映り込む会計ソフト選択UI。
        # SNS投稿には直接使用不可。マスキング後または Writer への参考資料として利用。
        "tags": ["csv", "export", "integration", "competitor-visible"],
        "weapon_compatibility": ["W2"],
        "persona_fit": ["P1", "P2", "P3"],
        "description": "CSV連携ドロップダウン — 弥生/freee/マネフォ選択UI（⚠️ 競合社名あり・SNS直接使用不可）",
        "has_pii": True,
        "masking_required": True,
    },
    {
        "index": 3,
        "category": "card",
        "tags": ["judgment-visible", "trust-badge", "approved", "transit"],
        "weapon_compatibility": ["W3", "W1"],
        "persona_fit": ["P1", "P2", "P3"],
        "description": "仕訳カード — 大阪市高速電気軌道（Suicaチャージ）・高信頼バッジ付き",
        "has_pii": False,
        "masking_required": False,
    },
    {
        "index": 4,
        "category": "pricing",
        "tags": ["pricing", "agent_plan"],
        "weapon_compatibility": ["W2"],
        "persona_fit": ["P3", "P4"],
        "description": "AGENT版価格 — ¥30,000〜¥250,000の4プラン（価格は要マスキング）",
        "has_pii": True,
        "masking_required": True,
    },
    {
        "index": 5,
        "category": "pricing",
        "tags": ["pricing", "saas_plan", "incentive-option"],
        "weapon_compatibility": ["W2", "W1"],
        "persona_fit": ["P1", "P2", "P3"],
        "description": "AI SaaS版価格 — ¥980/¥5,800・チームプラン・インセンティブオプション",
        "has_pii": False,
        "masking_required": False,
    },
    {
        "index": 6,
        "category": "dashboard",
        "tags": ["staff", "invite", "team", "empty-state"],
        "weapon_compatibility": ["W4", "W5"],
        "persona_fit": ["P2", "P3"],
        "description": "スタッフ招待画面 — 「まだスタッフがいません」空状態UI",
        "has_pii": False,
        "masking_required": False,
    },
    {
        "index": 7,
        "category": "dashboard",
        "tags": ["csv", "export", "multi-file", "drag-drop"],
        "weapon_compatibility": ["W2", "W3"],
        "persona_fit": ["P1", "P2", "P3"],
        "description": "CSV統合・変換 — 複数CSVドロップ画面",
        "has_pii": False,
        "masking_required": False,
    },
    {
        "index": 8,
        "category": "dashboard",
        "tags": ["category-rule", "settings", "learning", "empty-state"],
        "weapon_compatibility": ["W3"],
        "persona_fit": ["P3", "P4"],
        "description": "仕訳ルール学習・カテゴリルール — 「まだ登録されていません」空状態UI",
        "has_pii": False,
        "masking_required": False,
    },
    {
        "index": 9,
        "category": "dashboard",
        "tags": ["master_list", "vendor_names", "learning"],
        "weapon_compatibility": ["W3", "W2"],
        "persona_fit": ["P3", "P4"],
        "description": "取引先マスタ — ゴディバ・ローソン・Seria等17社（店名は要マスキング）",
        "has_pii": True,
        "masking_required": True,
    },
    {
        "index": 10,
        "category": "scan",
        "tags": ["scan", "desktop", "camera", "upload-mode"],
        "weapon_compatibility": ["W1", "W2"],
        "persona_fit": ["P1", "P2"],
        "description": "スキャン画面PC — 「カメラで撮影/画像を選択」＋読み取りモード切替",
        "has_pii": False,
        "masking_required": False,
    },
    {
        "index": 11,
        "category": "dashboard",
        "tags": ["dashboard", "incentive", "stats", "gamification", "master"],
        "weapon_compatibility": ["W2", "W4"],
        "persona_fit": ["P2", "P1"],
        "description": "ダッシュボード全体 — インセンティブ79+・マスタ13社・累計処理数表示",
        "has_pii": False,
        "masking_required": False,
    },
    {
        "index": 12,
        "category": "dashboard",
        "tags": ["incentive", "progress-bar", "gamification", "milestone"],
        "weapon_compatibility": ["W2", "W4", "W5"],
        "persona_fit": ["P1", "P2"],
        "description": "インセンティブ拡大 — 91枚/1000枚プログレスバー",
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
    return f"{STORAGE_PREFIX}/{Path(filename).name}"


async def upload_all(supabase: Client) -> None:
    print(f"[upload_assets] RAW_DIR: {RAW_DIR}")
    print(f"[upload_assets] BUCKET : {BUCKET}\n")

    # バケット作成（既存の場合はスキップ）
    try:
        supabase.storage.create_bucket(BUCKET, options={"public": False})
        print(f"[upload_assets] バケット '{BUCKET}' を作成しました\n")
    except Exception as e:
        if "already exists" in str(e).lower() or "Duplicate" in str(e):
            print(f"[upload_assets] バケット '{BUCKET}' は既存。スキップ。\n")
        else:
            print(f"[upload_assets] バケット作成エラー: {e}\n")

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
