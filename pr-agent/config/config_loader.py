from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, field_validator

_CONFIG_DIR = Path(__file__).parent


def _load(filename: str) -> dict[str, Any]:
    with open(_CONFIG_DIR / filename, encoding="utf-8") as f:
        return yaml.safe_load(f)


# ---------------------------------------------------------------------------
# Pydantic models — 起動時バリデーション用
# ---------------------------------------------------------------------------

class CharacterParameters(BaseModel):
    humor: float
    shock: float
    slapstick: float
    seriousness: float

    @field_validator("humor", "shock", "slapstick", "seriousness")
    @classmethod
    def in_range(cls, v: float) -> float:
        if not 0.0 <= v <= 1.0:
            raise ValueError(f"parameter must be 0.0–1.0, got {v}")
        return v


class Character(BaseModel):
    display_name: str
    voice: str
    pronoun: str
    parameters: CharacterParameters
    catchphrase_examples: list[str]
    best_for_weapons: list[str]
    best_for_personas: list[str]


class Persona(BaseModel):
    name: str
    appeal_axes: list[str]
    forbidden_topics: list[str]
    tone_hint: str
    best_platforms: list[str]


class Weapon(BaseModel):
    name: str
    description: str
    structure_hint: str
    example_template: str


class Trigger(BaseModel):
    name: str
    description: str
    intensity_hint: str
    suitable_weapons: list[str]
    modifier_text: str


# ---------------------------------------------------------------------------
# Public loader functions
# ---------------------------------------------------------------------------

def load_personas() -> dict[str, Persona]:
    raw = _load("personas.yaml")["personas"]
    return {k: Persona(**v) for k, v in raw.items()}


def load_characters() -> dict[str, Character]:
    raw = _load("characters.yaml")["characters"]
    return {k: Character(**v) for k, v in raw.items()}


def load_weapons() -> dict[str, Weapon]:
    raw = _load("weapons.yaml")["weapons"]
    return {k: Weapon(**v) for k, v in raw.items()}


def load_triggers() -> dict[str, Trigger]:
    raw = _load("triggers.yaml")["triggers"]
    return {k: Trigger(**v) for k, v in raw.items()}


def load_time_table() -> dict[str, Any]:
    return _load("time_table.yaml")


def load_all() -> dict[str, Any]:
    """全設定をまとめてロード。起動時バリデーションに使う。"""
    return {
        "personas": load_personas(),
        "characters": load_characters(),
        "weapons": load_weapons(),
        "triggers": load_triggers(),
        "time_table": load_time_table(),
    }
