"""
T1-6: Writer ノード — SNS 投稿文 3案生成

Persona × Character × Weapon × Trigger の4軸から Anthropic Claude を使って
プラットフォーム別の投稿ドラフトを3案生成する LangGraph 互換ノード。

CLI:
  uv run python -m brain.writer \
    --persona P1 --character shoyo_kun --weapon W1 --trigger antagonism --platform x
"""

import argparse
import asyncio
import json
import os

import anthropic
from dotenv import load_dotenv
from pydantic import BaseModel

from config.config_loader import (
    load_characters,
    load_personas,
    load_time_table,
    load_triggers,
    load_weapons,
)

load_dotenv()

# X は CJK 1文字 = 2 weighted chars なので日本語の実質上限は 140 文字
_JP_CHAR_LIMIT_X = 140

_DEFAULT_MODEL = os.getenv("ANTHROPIC_MODEL_DEFAULT", "claude-sonnet-4-6")


# ============================================================
# I/O モデル
# ============================================================

class WriterInput(BaseModel):
    persona_id: str          # P1–P4
    character_id: str        # shoyo_kun / shoyo_chan / zeirishi_sensei / keiri_san / shacho
    weapon_id: str           # W1–W6
    trigger_id: str          # antagonism / altruism / storytelling
    platform: str            # x / threads / instagram / note / zenn
    visual_description: str = ""   # visual_assets.description（任意）
    context: str = ""              # トレンド・外部コンテキスト（任意）
    language: str = "ja"          # "ja"（日本語）/ "en"（英語・P5-3）


class DraftPost(BaseModel):
    body: str
    platform: str
    char_count: int
    over_limit: bool
    angle: str               # "A" / "B" / "C" — 3案それぞれの切り口ラベル
    persona_id: str
    character_id: str
    weapon_id: str
    trigger_id: str


class WriterOutput(BaseModel):
    drafts: list[DraftPost]
    model_used: str
    usage_input_tokens: int
    usage_output_tokens: int


# ============================================================
# プロンプト構築ヘルパー
# ============================================================

def _param_to_instruction(name: str, value: float) -> str:
    """キャラクターパラメーター (0.0–1.0) を文章指示に変換する"""
    levels = {
        "humor":      {0.8: "ユーモアを積極的に使う",    0.4: "軽いユーモアを適宜入れる",    0.0: "ユーモアは不要"},
        "shock":      {0.8: "驚きや意外性を強調する",      0.4: "適度に意外性を演出する",        0.0: "穏やかなトーンで"},
        "slapstick":  {0.8: "大げさなリアクションOK",    0.4: "少しオーバーに反応する",        0.0: "落ち着いた表現で"},
        "seriousness": {0.8: "真剣・論理的なトーンで",   0.4: "ある程度真面目に",              0.0: "軽いノリで"},
    }
    thresholds = levels.get(name, {})
    for threshold in sorted(thresholds.keys(), reverse=True):
        if value >= threshold:
            return thresholds[threshold]
    return list(thresholds.values())[-1]


def _build_system_prompt(char_id: str, language: str = "ja") -> str:
    """キャラクター定義からシステムプロンプトを組み立てる"""
    chars = load_characters()
    if char_id not in chars:
        raise ValueError(f"character_id '{char_id}' が characters.yaml に存在しません")
    c = chars[char_id]
    p = c.parameters

    instructions = [
        _param_to_instruction("humor",       p.humor),
        _param_to_instruction("shock",       p.shock),
        _param_to_instruction("slapstick",   p.slapstick),
        _param_to_instruction("seriousness", p.seriousness),
    ]

    catchphrases = "\n".join(f"  - {ex}" for ex in c.catchphrase_examples)

    lang_instruction = (
        "\n【言語】すべての投稿文を自然な英語で書いてください。日本語は使わないこと。"
        if language == "en" else ""
    )

    return f"""あなたは SNS マーケティングエージェントのキャラクター「{c.display_name}」として投稿文を書きます。

【話し方・一人称】
- 一人称: {c.pronoun}
- 口調: {c.voice}（voice コード）
- {instructions[0]}
- {instructions[1]}
- {instructions[2]}
- {instructions[3]}

【口癖・キャッチフレーズの例】
{catchphrases}

【絶対ルール】
- 競合他社（弥生会計・freee・マネーフォワード 等）を名指しで批判しない
- 法律・税務の断定表現を使わない（「一般的に」「ケースによります」を使う）
- ハッシュタグは Instagram のみ付与（他プラットフォームでは付けない）
- 出力は必ず JSON 形式のみ（説明文や markdown ブロックは不要）{lang_instruction}"""


def _effective_char_limit(platform: str) -> int | None:
    """プラットフォームの実質文字数上限を返す（None = 制限なし）"""
    tt = load_time_table()
    limit = tt.get("char_limits", {}).get(platform)
    if platform == "x" and limit is not None:
        return _JP_CHAR_LIMIT_X  # 日本語上限に換算
    return limit  # None = 制限なし


def _build_user_prompt(inp: WriterInput) -> str:
    """Weapon × Trigger × Persona × Platform からユーザープロンプトを組み立てる"""
    personas   = load_personas()
    weapons    = load_weapons()
    triggers   = load_triggers()
    tt         = load_time_table()

    if inp.persona_id not in personas:
        raise ValueError(f"persona_id '{inp.persona_id}' が personas.yaml に存在しません")
    if inp.weapon_id not in weapons:
        raise ValueError(f"weapon_id '{inp.weapon_id}' が weapons.yaml に存在しません")
    if inp.trigger_id not in triggers:
        raise ValueError(f"trigger_id '{inp.trigger_id}' が triggers.yaml に存在しません")

    persona  = personas[inp.persona_id]
    weapon   = weapons[inp.weapon_id]
    trigger  = triggers[inp.trigger_id]

    char_limit = _effective_char_limit(inp.platform)
    limit_text = f"{char_limit}文字以内" if char_limit else "文字数制限なし"

    platform_trait = tt.get("platform_traits", {}).get(inp.platform, "")
    appeal_axes    = "、".join(persona.appeal_axes)
    forbidden      = "、".join(persona.forbidden_topics)

    visual_block = ""
    if inp.visual_description:
        visual_block = f"\n【参照ビジュアル】\n{inp.visual_description}\n（このビジュアルと連動する文章にしてください）"

    context_block = ""
    if inp.context:
        context_block = f"\n【外部コンテキスト / トレンド】\n{inp.context}\n"

    return f"""以下の条件で SNS 投稿文を **3案（A・B・C）** 生成してください。

━━ プラットフォーム ━━
- 媒体: {inp.platform}
- 文字数: {limit_text}
- 媒体特性: {platform_trait}

━━ ターゲットペルソナ ━━
- ペルソナ: {persona.name}（{inp.persona_id}）
- 訴求軸: {appeal_axes}
- トーン: {persona.tone_hint}
- 禁止トピック: {forbidden}

━━ 戦略構文（Weapon）━━
- 構文: {weapon.name}（{inp.weapon_id}）
- 説明: {weapon.description}
- 構造ガイド:
{weapon.structure_hint}
- テンプレート参考:
{weapon.example_template}

━━ 拡散トリガー ━━
- トリガー: {trigger.name}
- 修飾指示: {trigger.modifier_text}
{visual_block}{context_block}
━━ 出力フォーマット ━━
以下の JSON を **そのまま** 返してください（マークダウン記法・説明文不要）:

{{
  "drafts": [
    {{
      "angle": "A",
      "angle_label": "（このアングルの一言メモ）",
      "body": "（投稿本文）"
    }},
    {{
      "angle": "B",
      "angle_label": "（このアングルの一言メモ）",
      "body": "（投稿本文）"
    }},
    {{
      "angle": "C",
      "angle_label": "（このアングルの一言メモ）",
      "body": "（投稿本文）"
    }}
  ]
}}

3案それぞれで **切り口を変えて** ください（書き出し・強調点・感情温度を変える）。
文字数は{limit_text}を守ること。{"すべての body は英語で書いてください。" if inp.language == "en" else ""}"""


# ============================================================
# Writer ノード
# ============================================================

class WriterNode:
    """LangGraph ノードとして呼び出せる Writer。単体でも動作する。"""

    def __init__(self, model: str | None = None) -> None:
        self._model = model or _DEFAULT_MODEL
        self._client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

    async def run(self, inp: WriterInput) -> WriterOutput:
        system = _build_system_prompt(inp.character_id, inp.language)
        user   = _build_user_prompt(inp)

        # note / zenn は長文3案のため max_tokens を増やす
        max_tokens = 6000 if inp.platform in ("note", "zenn") else 2048

        # 同期 SDK をスレッドプールで実行（asyncio 互換）
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: self._client.messages.create(
                model=self._model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user}],
            ),
        )

        raw_text = response.content[0].text.strip()

        # JSON ブロックがある場合は中身だけ抜き出す
        if "```" in raw_text:
            parts = raw_text.split("```")
            for part in parts:
                if part.startswith("json"):
                    raw_text = part[4:].strip()
                    break
                elif "{" in part:
                    raw_text = part.strip()
                    break

        # JSONが途中で切れた場合のフォールバック: 最後の有効な } まで切り詰める
        try:
            parsed = json.loads(raw_text)
        except json.JSONDecodeError:
            last_brace = raw_text.rfind("}")
            if last_brace != -1:
                raw_text = raw_text[:last_brace + 1]
            parsed = json.loads(raw_text)
        char_limit = _effective_char_limit(inp.platform)

        drafts: list[DraftPost] = []
        for item in parsed["drafts"]:
            body  = item["body"]
            count = len(body)
            drafts.append(
                DraftPost(
                    body=body,
                    platform=inp.platform,
                    char_count=count,
                    over_limit=(char_limit is not None and count > char_limit),
                    angle=item["angle"],
                    persona_id=inp.persona_id,
                    character_id=inp.character_id,
                    weapon_id=inp.weapon_id,
                    trigger_id=inp.trigger_id,
                )
            )

        return WriterOutput(
            drafts=drafts,
            model_used=response.model,
            usage_input_tokens=response.usage.input_tokens,
            usage_output_tokens=response.usage.output_tokens,
        )


# ============================================================
# CLI
# ============================================================

async def _cli_main(args: argparse.Namespace) -> None:
    node = WriterNode()
    inp  = WriterInput(
        persona_id=args.persona,
        character_id=args.character,
        weapon_id=args.weapon,
        trigger_id=args.trigger,
        platform=args.platform,
        context=args.context or "",
        language=args.language,
    )
    lang_label = "EN" if args.language == "en" else "JA"
    print(f"[writer] {inp.persona_id} × {inp.character_id} × {inp.weapon_id} × {inp.trigger_id} → {inp.platform} [{lang_label}]")
    print("[writer] 生成中...\n")

    output = await node.run(inp)

    for draft in output.drafts:
        limit = _effective_char_limit(inp.platform)
        limit_str = f"/{limit}" if limit else ""
        over = " ⚠️ over limit" if draft.over_limit else ""
        print(f"── 案{draft.angle} ({draft.char_count}{limit_str}字{over}) ──")
        print(draft.body)
        print()

    print(f"[writer] model={output.model_used} "
          f"in={output.usage_input_tokens} out={output.usage_output_tokens} tokens")


def main() -> None:
    parser = argparse.ArgumentParser(description="shiwake-ai Writer ノード CLI")
    parser.add_argument("--persona",   required=True, choices=["P1", "P2", "P3", "P4"])
    parser.add_argument("--character", required=True,
                        choices=["shoyo_kun", "shoyo_chan", "zeirishi_sensei", "keiri_san", "shacho"])
    parser.add_argument("--weapon",    required=True, choices=["W1", "W2", "W3", "W4", "W5", "W6"])
    parser.add_argument("--trigger",   required=True,
                        choices=["antagonism", "altruism", "storytelling"])
    parser.add_argument("--platform",  required=True,
                        choices=["x", "threads", "instagram", "note", "zenn"])
    parser.add_argument("--context",   default="", help="トレンド等の外部コンテキスト（任意）")
    parser.add_argument("--language",  default="ja", choices=["ja", "en"],
                        help="投稿言語: ja（日本語・デフォルト）/ en（英語・P5-3）")
    args = parser.parse_args()
    asyncio.run(_cli_main(args))


if __name__ == "__main__":
    main()
