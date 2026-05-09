"""
P3-2 / P5-4: TrendWatcher ノード — 外部情報の取り込み

監視対象:
  - 公的機関: 国税庁 / 財務省 / デジタル庁
  - 市場動向(P5-4): PR TIMES / freee RSS / マネーフォワード RSS / 弥生プレスリリース

保存先: trends テーブル (url_hash で重複除外)
連携: Planner が直近24hの上位N件を参照

CLI:
  uv run python -m brain.trend_watcher fetch    # 全ソース巡回して trends テーブルに保存
  uv run python -m brain.trend_watcher inject   # 直近24hの上位N件を表示(Planner 用確認)
"""

import argparse
import asyncio
import hashlib
import os
import xml.etree.ElementTree as ET
import yaml
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from pydantic import BaseModel
from supabase import create_client, Client

load_dotenv()

_SUPABASE_URL  = os.getenv("SUPABASE_URL", "")
_SUPABASE_KEY  = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
_SOURCES_PATH  = Path(__file__).parent.parent / "config" / "trend_sources.yaml"
_UA            = "shiwake-ai-trend/1.0"


class TrendItem(BaseModel):
    source_id:        str
    title:            str
    url:              str
    published_at:     Optional[datetime] = None
    category:         str
    weight:           float
    score:            float = 0.0
    matched_keywords: list[str] = []


class TrendWatcherNode:
    def __init__(self) -> None:
        self._supabase: Client = create_client(_SUPABASE_URL, _SUPABASE_KEY)
        with open(_SOURCES_PATH) as f:
            self._cfg = yaml.safe_load(f)

    # ------------------------------------------------------------------
    async def fetch_all(self) -> list[TrendItem]:
        """全ソースを巡回して新規トレンドを trends テーブルに保存"""
        all_items: list[TrendItem] = []
        for src in self._cfg["sources"]:
            if not src.get("enabled", True):
                continue
            try:
                items = await self._fetch_one(src)
                all_items.extend(items)
            except Exception as e:
                print(f"[trend] {src['id']} の取得失敗: {e}")

        for item in all_items:
            item.score, item.matched_keywords = self._score(item)

        saved = sum(1 for item in all_items if self._save_if_new(item))
        print(f"[trend] {len(all_items)}件取得 / {saved}件新規保存")
        return all_items

    async def _fetch_one(self, src: dict) -> list[TrendItem]:
        """1ソースから取得 → TrendItem のリスト（html_scrape / rss に対応）"""
        async with httpx.AsyncClient(
            timeout=30,
            follow_redirects=True,
            headers={"User-Agent": _UA},
        ) as client:
            r = await client.get(src["url"])
            r.raise_for_status()

        src_type = src.get("type", "html_scrape")
        if src_type == "rss":
            return self._parse_rss(r.text, src)
        return self._parse_html(r.text, src)

    def _parse_html(self, html: str, src: dict) -> list[TrendItem]:
        """BeautifulSoup で HTML をパース"""
        soup  = BeautifulSoup(html, "html.parser")
        nodes = soup.select(src["selector"])
        items: list[TrendItem] = []

        for node in nodes[:20]:
            link = node if node.name == "a" else node.find("a")
            if not link:
                continue
            title = link.get_text(strip=True)
            href  = link.get("href", "")
            if not href or not title:
                continue
            if href.startswith("/"):
                href = urljoin(src["url"], href)
            items.append(TrendItem(
                source_id=src["id"],
                title=title,
                url=href,
                category=src.get("category", "general"),
                weight=float(src.get("weight", 1.0)),
            ))
        return items

    def _parse_rss(self, xml_text: str, src: dict) -> list[TrendItem]:
        """RSS / Atom フィードを ElementTree でパース"""
        items: list[TrendItem] = []
        try:
            root = ET.fromstring(xml_text)
        except ET.ParseError:
            return items

        ns = {"atom": "http://www.w3.org/2005/Atom"}

        # RSS 2.0
        for entry in root.findall(".//item")[:20]:
            title_el = entry.find("title")
            link_el  = entry.find("link")
            title = title_el.text.strip() if title_el is not None and title_el.text else ""
            href  = link_el.text.strip() if link_el is not None and link_el.text else ""
            if title and href:
                items.append(TrendItem(
                    source_id=src["id"],
                    title=title,
                    url=href,
                    category=src.get("category", "general"),
                    weight=float(src.get("weight", 1.0)),
                ))

        # Atom
        if not items:
            for entry in root.findall(".//atom:entry", ns)[:20]:
                title_el = entry.find("atom:title", ns)
                link_el  = entry.find("atom:link", ns)
                title = title_el.text.strip() if title_el is not None and title_el.text else ""
                href  = link_el.get("href", "") if link_el is not None else ""
                if title and href:
                    items.append(TrendItem(
                        source_id=src["id"],
                        title=title,
                        url=href,
                        category=src.get("category", "general"),
                        weight=float(src.get("weight", 1.0)),
                    ))
        return items

    def _score(self, item: TrendItem) -> tuple[float, list[str]]:
        """キーワードヒット × weight でスコアリング。除外キーワードがあれば 0.0"""
        high          = self._cfg.get("keywords_high_priority", [])
        market_trend  = self._cfg.get("keywords_market_trend", [])
        exclude       = self._cfg.get("keywords_exclude", [])

        text = item.title
        if any(kw in text for kw in exclude):
            return 0.0, []

        matched = [kw for kw in high if kw in text]
        score   = len(matched) * item.weight

        # market_trend カテゴリは市場動向キーワードでも加点
        if item.category == "market_trend":
            mt_matched = [kw for kw in market_trend if kw in text]
            score  += len(mt_matched) * item.weight * 0.5
            matched += mt_matched

        return score, matched

    def _save_if_new(self, item: TrendItem) -> bool:
        """trends テーブルに保存(url_hash で重複スキップ)"""
        url_hash = hashlib.sha256(item.url.encode()).hexdigest()[:16]
        existing = (
            self._supabase.table("trends")
            .select("id")
            .eq("url_hash", url_hash)
            .execute()
        ).data
        if existing:
            return False

        self._supabase.table("trends").insert({
            "source_id":        item.source_id,
            "title":            item.title,
            "url":              item.url,
            "url_hash":         url_hash,
            "category":         item.category,
            "weight":           item.weight,
            "score":            item.score,
            "matched_keywords": item.matched_keywords,
            "fetched_at":       datetime.now(timezone.utc).isoformat(),
        }).execute()
        return True

    # ------------------------------------------------------------------
    async def get_top_for_planner(
        self,
        hours: int = 24,
        top_n: int | None = None,
    ) -> list[dict]:
        """直近 N 時間の上位 top_n 件を Planner 用に返す"""
        n      = top_n or self._cfg.get("inject_top_n", 3)
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
        rows   = (
            self._supabase.table("trends")
            .select("source_id,title,url,category,score,matched_keywords")
            .gte("fetched_at", cutoff)
            .gt("score", 0)
            .order("score", desc=True)
            .limit(n)
            .execute()
        ).data
        return rows


# ============================================================
# CLI
# ============================================================

async def _cmd_fetch(args: argparse.Namespace) -> None:
    node = TrendWatcherNode()
    await node.fetch_all()


async def _cmd_inject(args: argparse.Namespace) -> None:
    node = TrendWatcherNode()
    top  = await node.get_top_for_planner(hours=24)
    print(f"[trend] Planner 用 上位{len(top)}件:")
    for r in top:
        kw = ", ".join(r.get("matched_keywords") or [])
        print(f"  ({r['score']:.1f}) [{r['source_id']}] {r['title']}")
        if kw:
            print(f"        キーワード: {kw}")


def main() -> None:
    p   = argparse.ArgumentParser(description="TrendWatcher CLI")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("fetch",  help="全ソースを巡回して trends テーブルに保存")
    sub.add_parser("inject", help="直近24hの上位N件を表示(Planner 用確認)")
    args = p.parse_args()
    cmds = {"fetch": _cmd_fetch, "inject": _cmd_inject}
    asyncio.run(cmds[args.cmd](args))


if __name__ == "__main__":
    main()
