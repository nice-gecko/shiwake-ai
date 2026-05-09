"""
P4-1: Zenn 記事生成

Writer ノードを Zenn 用長文モード（3000-5000字）で起動し、
zenn-content リポジトリ用フォーマットの Markdown を生成する。

CLI:
  uv run python -m brain.zenn_writer generate --topic "Memory Bank 設計"
  uv run python -m brain.zenn_writer publish  --draft 2026-05-09_memory-bank-design.md
"""

import argparse
import os
import re
import subprocess
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()

_DRAFTS_DIR   = Path(__file__).parent.parent / "dashboard" / "output" / "zenn_drafts"
_ZENN_REPO    = Path(os.getenv("ZENN_REPO_PATH", str(Path.home() / "APP" / "zenn-content")))
_JST          = ZoneInfo("Asia/Tokyo")
_MODEL        = "claude-sonnet-4-6"

_SYSTEM = """あなたは shiwake-ai の開発者として、Zenn 向けの技術記事を執筆します。
対象読者: 中上級エンジニア（AI・SaaS・会計テックに興味のある層）
文量: 3000〜5000字
スタイル: 実践的・具体的・コードや設計図を積極的に含める
トーン: 自分の経験として語る一人称、フラットな文体

必ずZennのMarkdownフォーマットで出力してください:
---
title: "..."
emoji: "..."
type: "tech"
topics: [...]
published: false
---

## はじめに

...（本文）...

## まとめ
"""


def _slugify(topic: str) -> str:
    slug = re.sub(r"[^\w぀-鿿]", "-", topic.lower()).strip("-")
    slug = re.sub(r"-{2,}", "-", slug)
    return slug[:50]


def cmd_generate(args: argparse.Namespace) -> None:
    """Zenn 記事を生成して zenn_drafts/ に保存"""
    topic = args.topic
    now   = datetime.now(_JST)

    client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
    prompt = (
        f"以下のトピックで Zenn の技術記事を書いてください。\n\n"
        f"トピック: {topic}\n\n"
        f"shiwake-ai（税理士事務所向け AI 仕訳補助ツール）または "
        f"PR Agent（SNS 自動投稿エージェント）の実装経験を元にした記事にすること。\n"
        f"具体的なコードスニペットやアーキテクチャ図（Mermaid / ASCII）を含めること。"
    )

    print(f"[zenn] 記事生成中: {topic}")
    response = client.messages.create(
        model=_MODEL,
        max_tokens=8000,
        messages=[{"role": "user", "content": prompt}],
        system=_SYSTEM,
    )
    content = response.content[0].text.strip()

    _DRAFTS_DIR.mkdir(parents=True, exist_ok=True)
    slug     = _slugify(topic)
    filename = f"{now.strftime('%Y-%m-%d')}_{slug}.md"
    path     = _DRAFTS_DIR / filename
    path.write_text(content, encoding="utf-8")
    print(f"[zenn] 生成完了: {path}")

    # Discord 通知
    try:
        from notify.discord import _post as discord_post
        discord_post({
            "embeds": [{
                "title":       "👾 Zenn 下書き完成",
                "description": f"**{topic}**\n\nレビューして承認してください。",
                "color":       0x3EA8FF,
                "fields": [
                    {"name": "ファイル", "value": f"`{filename}`", "inline": True},
                ],
            }]
        })
    except Exception:
        pass


def cmd_publish(args: argparse.Namespace) -> None:
    """承認済み下書きを zenn-content リポジトリにコピーして push"""
    draft_name = args.draft
    src = _DRAFTS_DIR / draft_name
    if not src.exists():
        print(f"[zenn] ファイルが見つかりません: {src}")
        return

    articles_dir = _ZENN_REPO / "articles"
    articles_dir.mkdir(parents=True, exist_ok=True)
    dst = articles_dir / draft_name
    dst.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"[zenn] コピー完了: {dst}")

    # git commit & push
    try:
        subprocess.run(["git", "add", str(dst)], cwd=str(_ZENN_REPO), check=True)
        subprocess.run(
            ["git", "commit", "-m", f"add: {draft_name}"],
            cwd=str(_ZENN_REPO),
            check=True,
        )
        subprocess.run(["git", "push"], cwd=str(_ZENN_REPO), check=True)
        print("[zenn] zenn-content リポジトリに push しました")
    except subprocess.CalledProcessError as e:
        print(f"[zenn] git エラー: {e}")


def main() -> None:
    p   = argparse.ArgumentParser(description="Zenn 記事生成 CLI")
    sub = p.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("generate", help="記事を生成して zenn_drafts/ に保存")
    g.add_argument("--topic", required=True, help="記事のトピック")

    pub = sub.add_parser("publish", help="下書きを zenn-content に push")
    pub.add_argument("--draft", required=True, help="ファイル名（例: 2026-05-09_memory-bank.md）")

    args = p.parse_args()
    {"generate": cmd_generate, "publish": cmd_publish}[args.cmd](args)


if __name__ == "__main__":
    main()
