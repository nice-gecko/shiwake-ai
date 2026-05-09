"""
P5-1: Adobe Firefly 用プロンプト生成

weapon_id × persona_id × platform の組み合わせから
Adobe Firefly に渡す英語プロンプトとアスペクト比を生成する。
"""

# ============================================================
# weapon → ビジュアルコンセプト
# ============================================================

_WEAPON_VISUAL: dict[str, dict] = {
    "W1": {
        "concept": "liberation from tedious work, breaking chains of manual entry, "
                   "transformation from old to new, contrast between struggle and freedom",
        "style":   "bold, high contrast, dramatic lighting",
    },
    "W2": {
        "concept": "clean comparison chart, before-and-after layout, "
                   "side-by-side visualization of efficiency improvement, minimalist data design",
        "style":   "clean, minimalist, infographic-style",
    },
    "W3": {
        "concept": "professional accountant at clean desk, expertise and precision, "
                   "documents and spreadsheets, authoritative yet approachable",
        "style":   "professional, trustworthy, warm office lighting",
    },
    "W4": {
        "concept": "authentic human emotion, personal journey, "
                   "developer working late, warm ambient light, genuine moment",
        "style":   "warm, candid, cinematic, emotional depth",
    },
    "W5": {
        "concept": "community engagement, conversation bubbles, "
                   "people connecting and sharing ideas, interactive energy",
        "style":   "vibrant, social, friendly, open",
    },
    "W6": {
        "concept": "surprise and viral excitement, notifications flooding screen, "
                   "shocked reaction, overwhelming positive engagement",
        "style":   "dynamic, energetic, chaotic-but-fun",
    },
}

# ============================================================
# persona → 雰囲気・対象読者
# ============================================================

_PERSONA_TONE: dict[str, str] = {
    "P1": "casual and relatable atmosphere for freelancers and sole proprietors, slightly tired but hopeful",
    "P2": "energetic and gamified for office staff, fun reward elements, bright colors",
    "P3": "corporate and data-driven for business owners, clean ROI focus, neutral professional tones",
    "P4": "precise and trustworthy for tax accountants, subdued professional colors, formal",
}

# ============================================================
# platform → アスペクト比・サイズ指定
# ============================================================

_PLATFORM_RATIO: dict[str, dict] = {
    "instagram": {"ratio": "1:1",  "label": "square, 1080x1080"},
    "threads":   {"ratio": "4:5",  "label": "portrait, 1080x1350"},
    "x":         {"ratio": "16:9", "label": "landscape, 1200x675"},
    "note":      {"ratio": "16:9", "label": "landscape, 1280x720"},
    "zenn":      {"ratio": "16:9", "label": "landscape, 1280x720"},
}

# ============================================================
# 共通の negative prompt
# ============================================================

_NEGATIVE = (
    "text overlays, watermarks, logos, people faces (use abstract or silhouette only), "
    "competitor product logos, low quality, blurry, generic stock photo look"
)

# ============================================================
# shiwake-ai ブランドコンテキスト
# ============================================================

_BRAND_CONTEXT = (
    "for shiwake-ai, a Japanese AI bookkeeping assistant SaaS product, "
    "Japanese business context, accounting and bookkeeping theme"
)


# ============================================================
# Public API
# ============================================================

def build_prompt(weapon_id: str, persona_id: str, platform: str) -> dict:
    """
    weapon × persona × platform から Adobe Firefly 用プロンプトを生成。

    Returns:
        {
          "firefly_prompt": str,   # Firefly に渡すメインプロンプト
          "negative_prompt": str,
          "aspect_ratio": str,     # "1:1" / "4:5" / "16:9"
          "size_label": str,       # 説明用
        }
    """
    weapon  = _WEAPON_VISUAL.get(weapon_id, _WEAPON_VISUAL["W1"])
    tone    = _PERSONA_TONE.get(persona_id, _PERSONA_TONE["P1"])
    ratio   = _PLATFORM_RATIO.get(platform, _PLATFORM_RATIO["threads"])

    prompt = (
        f"{weapon['concept']}, "
        f"{tone}, "
        f"{_BRAND_CONTEXT}, "
        f"{weapon['style']}, "
        f"high quality digital illustration or photography, {ratio['label']}"
    )

    return {
        "firefly_prompt": prompt,
        "negative_prompt": _NEGATIVE,
        "aspect_ratio": ratio["ratio"],
        "size_label":   ratio["label"],
    }
