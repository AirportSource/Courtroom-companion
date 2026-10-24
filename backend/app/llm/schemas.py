"""Provider-independent contract between the LLM layer and the rest of the application.

The model expresses *semantic intent* only: dialogue text plus logical emotion / reaction /
gesture IDs drawn from the character's capabilities. It never names files, paths, components,
CSS or actions. Every provider's output is parsed into these models (see repair.py) and treated
as untrusted data.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

MAX_BEAT_TEXT = 600
MAX_BEATS = 8
ID_MAX = 40


class Beat(BaseModel):
    """One emotional/performance beat of a reply."""

    model_config = ConfigDict(extra="ignore")

    text: str = Field(min_length=1, max_length=MAX_BEAT_TEXT)
    #: Semantic emotion ID (e.g. "happy"). Unknown values are resolved by the director.
    emotion: str = Field(default="", max_length=ID_MAX)
    #: Strength of the emotion: 0.0 (barely) .. 1.0 (maximum). Default 0.5.
    intensity: float = Field(default=0.5, ge=0.0, le=1.0)
    #: Optional one-shot event (e.g. "shocked"); not a stable pose.
    reaction: str | None = Field(default=None, max_length=ID_MAX)
    #: Optional physical expression of the emotion (e.g. "arms_open").
    gesture: str | None = Field(default=None, max_length=ID_MAX)


class CharacterReply(BaseModel):
    """A validated, provider-independent character reply (1..MAX_BEATS beats)."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True, serialize_by_alias=True)

    beats: list[Beat] = Field(min_length=1, max_length=MAX_BEATS)
    #: Preferred stable emotion once the whole reply has been performed.
    settle_emotion: str | None = Field(default=None, alias="settleEmotion", max_length=ID_MAX)


class ChatMessage(BaseModel):
    """A conversation turn passed to providers (system prompt is passed separately)."""

    role: Literal["user", "assistant"]
    content: str
