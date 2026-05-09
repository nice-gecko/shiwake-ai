"""
P4-2: 営業ツール連携 — Cowork が leads / outreach_history を扱うための補助 CLI

主な機能:
  - leads テーブルの読み書き
  - outreach_history の集計
  - cowork_requests/*.json の生成（Cowork 起動シグナル）

CLI:
  uv run python -m brain.sales_pipeline list-leads [--status new] [--priority-min 4]
  uv run python -m brain.sales_pipeline import-leads --csv path/to/leads.csv
  uv run python -m brain.sales_pipeline outreach-stats [--month 2026-04]
  uv run python -m brain.sales_pipeline trigger-cowork --instruction lead_finder [--area 東京23区] [--count 10]
"""

import argparse
import csv
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

_SUPABASE_URL   = os.getenv("SUPABASE_URL", "")
_SUPABASE_KEY   = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
_REQUESTS_DIR   = Path(__file__).parent.parent / "dashboard" / "output" / "cowork_requests"
_JST            = ZoneInfo("Asia/Tokyo")


def _db() -> Client:
    return create_client(_SUPABASE_URL, _SUPABASE_KEY)


# ============================================================
# list-leads
# ============================================================

def cmd_list_leads(args: argparse.Namespace) -> None:
    """leads テーブルを一覧表示"""
    db = _db()
    q  = db.table("leads").select("*").order("priority_score", desc=True)
    if args.status:
        q = q.eq("status", args.status)
    if args.priority_min:
        q = q.gte("priority_score", args.priority_min)
    rows = q.limit(50).execute().data or []

    if not rows:
        print("[sales] リードなし")
        return

    print(f"[sales] {len(rows)}件のリード:")
    for r in rows:
        sp = ", ".join(r.get("specialty") or [])
        print(
            f"  [{r.get('priority_score', '-')}] {r['company_name']}"
            f"  {r.get('status', '')}  score={r.get('digital_savvy_score', '-')}"
            f"  {sp}"
        )


# ============================================================
# import-leads
# ============================================================

def cmd_import_leads(args: argparse.Namespace) -> None:
    """CSV を reads して leads テーブルに一括 INSERT"""
    csv_path = Path(args.csv)
    if not csv_path.exists():
        print(f"[sales] ファイルが見つかりません: {csv_path}")
        return

    db   = _db()
    rows = []
    with open(csv_path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            # specialty は "法人税務,相続" → ["法人税務","相続"]
            sp = row.get("specialty", "")
            specialty = [s.strip() for s in sp.split(",") if s.strip()] if sp else []

            rows.append({
                "company_name":        row.get("company_name", ""),
                "contact_person":      row.get("contact_person") or None,
                "email":               row.get("email") or None,
                "phone":               row.get("phone") or None,
                "website":             row.get("website") or None,
                "address":             row.get("address") or None,
                "size_estimate":       row.get("size_estimate") or None,
                "specialty":           specialty,
                "digital_savvy_score": int(row["digital_savvy_score"]) if row.get("digital_savvy_score") else None,
                "priority_score":      int(row["priority_score"])      if row.get("priority_score")      else None,
                "notes":               row.get("notes") or None,
                "found_by":            "cowork",
            })

    if not rows:
        print("[sales] CSV にデータがありません")
        return

    db.table("leads").insert(rows).execute()
    print(f"[sales] {len(rows)}件のリードを投入しました")


# ============================================================
# outreach-stats
# ============================================================

def cmd_outreach_stats(args: argparse.Namespace) -> None:
    """outreach_history の集計を表示"""
    db = _db()
    q  = db.table("outreach_history").select("*")
    if args.month:
        year, month = args.month.split("-")
        from_dt = f"{year}-{month}-01T00:00:00+00:00"
        next_m  = int(month) + 1
        next_y  = int(year) + (1 if next_m > 12 else 0)
        next_m  = next_m if next_m <= 12 else 1
        to_dt   = f"{next_y}-{next_m:02d}-01T00:00:00+00:00"
        q = q.gte("sent_at", from_dt).lt("sent_at", to_dt)

    rows  = q.execute().data or []
    sent  = len(rows)
    replied   = sum(1 for r in rows if r.get("response_received"))
    meetings  = sum(1 for r in rows if r.get("led_to_meeting"))
    signups   = sum(1 for r in rows if r.get("led_to_signup"))
    reply_rate = f"{replied / sent * 100:.1f}%" if sent > 0 else "N/A"

    label = args.month or "全期間"
    print(f"[sales] outreach 集計 ({label})")
    print(f"  送信: {sent}件 / 返信: {replied}件（返信率 {reply_rate}）")
    print(f"  ミーティング: {meetings}件 / サインアップ: {signups}件")


# ============================================================
# trigger-cowork
# ============================================================

def cmd_trigger_cowork(args: argparse.Namespace) -> None:
    """cowork_requests/ に実行依頼 JSON を生成"""
    _REQUESTS_DIR.mkdir(parents=True, exist_ok=True)

    now_jst  = datetime.now(_JST)
    filename = f"{now_jst.strftime('%Y-%m-%d_%H%M%S')}_{args.instruction}.json"
    params: dict = {}

    if args.instruction == "lead_finder":
        params = {
            "area":             getattr(args, "area", "東京23区"),
            "count":            getattr(args, "count", 10),
            "specialty_filter": getattr(args, "specialty", ""),
            "size":             getattr(args, "size", ""),
        }
    elif args.instruction == "outreach_writer":
        params = {
            "target":  getattr(args, "target", "priority_4_5"),
            "tone":    getattr(args, "tone", "professional"),
            "cta":     getattr(args, "cta", "demo"),
        }
    elif args.instruction == "monthly_report":
        params = {
            "month":  getattr(args, "month", now_jst.strftime("%Y-%m")),
            "format": getattr(args, "format", "md"),
        }

    payload = {
        "instruction":  args.instruction,
        "params":       params,
        "requested_at": now_jst.isoformat(),
        "requested_by": "cli",
        "status":       "pending",
    }

    path = _REQUESTS_DIR / filename
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[sales] Cowork 依頼を作成しました: {path}")


# ============================================================
# CLI
# ============================================================

def main() -> None:
    p   = argparse.ArgumentParser(description="営業パイプライン CLI")
    sub = p.add_subparsers(dest="cmd", required=True)

    # list-leads
    ll = sub.add_parser("list-leads", help="リード一覧を表示")
    ll.add_argument("--status",       default="", help="フィルタ: new/contacted/replied 等")
    ll.add_argument("--priority-min", type=int,   help="最低 priority_score")

    # import-leads
    il = sub.add_parser("import-leads", help="CSV からリードを一括投入")
    il.add_argument("--csv", required=True, help="CSV ファイルパス")

    # outreach-stats
    os_p = sub.add_parser("outreach-stats", help="outreach 集計を表示")
    os_p.add_argument("--month", help="対象月 YYYY-MM（省略で全期間）")

    # trigger-cowork
    tc = sub.add_parser("trigger-cowork", help="Cowork 依頼 JSON を生成")
    tc.add_argument("--instruction", required=True,
                    choices=["lead_finder", "outreach_writer", "monthly_report"])
    tc.add_argument("--area",      default="東京23区")
    tc.add_argument("--count",     type=int, default=10)
    tc.add_argument("--specialty", default="")
    tc.add_argument("--size",      default="")
    tc.add_argument("--target",    default="priority_4_5")
    tc.add_argument("--tone",      default="professional")
    tc.add_argument("--cta",       default="demo")
    tc.add_argument("--month",     default="")
    tc.add_argument("--format",    default="md")

    args = p.parse_args()
    {
        "list-leads":      cmd_list_leads,
        "import-leads":    cmd_import_leads,
        "outreach-stats":  cmd_outreach_stats,
        "trigger-cowork":  cmd_trigger_cowork,
    }[args.cmd](args)


if __name__ == "__main__":
    main()
