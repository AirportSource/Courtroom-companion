"""Schemas for lore analysis (D-101).

`Model*` classes describe what the LLM may return for one chunk. They are strict (unknown fields
rejected, bounded lengths) and contain no paths, commands or file names: the model only describes
facts and traits with page numbers and short verbatim evidence.

`Proposed*`, `Conflict` and `LoreProposal` are built by the application after validation,
grounding, deduplication and comparison; they are what a review UI shows (camelCase on the wire).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

FactCategory = Literal[
    "identity", "family", "relationship", "biography", "event", "location", "timeline",
    "motivation", "moral_conflict", "secret", "uncertain",
]
#: How the source supports a claim. Only "explicit" can become established lore without review.
Basis = Literal["explicit", "interpretation", "inferred", "uncertain"]
TraitKind = Literal["explicit_trait", "inferred_tendency", "speech_characteristic", "uncertain"]

MAX_FACTS_PER_CHUNK = 40
MAX_TRAITS_PER_CHUNK = 15
MAX_EVIDENCE_CHARS = 300


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ModelFact(_Strict):
    category: FactCategory
    subject: str = Field(min_length=1, max_length=120)
    predicate: str = Field(min_length=1, max_length=80)
    object: str | None = Field(default=None, max_length=200)
    description: str = Field(min_length=1, max_length=500)
    pages: list[int] = Field(min_length=1, max_length=6)
    evidence: str = Field(min_length=1, max_length=MAX_EVIDENCE_CHARS)
    basis: Basis
    narrative_time: str | None = Field(default=None, max_length=120)


class ModelTrait(_Strict):
    trait: str = Field(min_length=1, max_length=80)
    guidance: str = Field(min_length=1, max_length=400)
    kind: TraitKind
    pages: list[int] = Field(min_length=1, max_length=6)
    evidence: str = Field(min_length=1, max_length=MAX_EVIDENCE_CHARS)


class ModelChunkOutput(_Strict):
    facts: list[ModelFact] = Field(default_factory=list, max_length=MAX_FACTS_PER_CHUNK)
    traits: list[ModelTrait] = Field(default_factory=list, max_length=MAX_TRAITS_PER_CHUNK)


def model_output_schema() -> dict:
    """JSON schema sent to providers. Hand-written so it is valid for every adapter's native mode
    (OpenAI strict: no $defs/defaults, every property required, nullable instead of optional).
    Pydantic (`ModelChunkOutput`) remains the only authority on validity."""
    def string(limit: int) -> dict:
        return {"type": "string", "maxLength": limit}

    def nullable(limit: int) -> dict:
        return {"anyOf": [string(limit), {"type": "null"}]}

    pages = {"type": "array", "items": {"type": "integer", "minimum": 1}, "minItems": 1, "maxItems": 6}

    def obj(properties: dict) -> dict:
        return {"type": "object", "additionalProperties": False, "required": list(properties), "properties": properties}

    fact = obj({
        "category": {"type": "string", "enum": list(FactCategory.__args__)},
        "subject": string(120), "predicate": string(80), "object": nullable(200), "description": string(500),
        "pages": pages, "evidence": string(MAX_EVIDENCE_CHARS),
        "basis": {"type": "string", "enum": list(Basis.__args__)}, "narrative_time": nullable(120),
    })
    trait = obj({
        "trait": string(80), "guidance": string(400), "kind": {"type": "string", "enum": list(TraitKind.__args__)},
        "pages": pages, "evidence": string(MAX_EVIDENCE_CHARS),
    })
    return obj({"facts": {"type": "array", "items": fact, "maxItems": MAX_FACTS_PER_CHUNK},
                "traits": {"type": "array", "items": trait, "maxItems": MAX_TRAITS_PER_CHUNK}})


# ---- application-built proposal ----------------------------------------------------------------


class _Out(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


EvidenceStatus = Literal["verified", "fuzzy", "other_page", "not_found", "invalid_page"]
ReviewStatus = Literal["proposed", "needs_review", "rejected"]


class EvidenceCheck(_Out):
    status: EvidenceStatus
    #: Page where the evidence was actually found (may differ from the cited page).
    page: int | None = None
    score: float = 0.0


class SupportingReference(_Out):
    pages: list[int]
    evidence: str


class ProposedFact(_Out):
    id: str
    category: FactCategory
    subject: str
    predicate: str
    object: str | None = None
    description: str
    basis: Basis
    narrative_time: str | None = None
    source_document: str
    source_pages: list[int]
    evidence: str
    evidence_check: EvidenceCheck
    review_status: ReviewStatus
    flags: list[str] = Field(default_factory=list)
    #: Further passages that state the same fact (merged duplicates).
    also_supported_by: list[SupportingReference] = Field(default_factory=list)
    #: Existing lore lines that already state this fact.
    matches_existing: list[str] = Field(default_factory=list)


class ProposedTrait(_Out):
    id: str
    trait: str
    guidance: str
    kind: TraitKind
    source_pages: list[int]
    evidence: str
    evidence_check: EvidenceCheck
    review_status: ReviewStatus
    flags: list[str] = Field(default_factory=list)
    also_supported_by: list[SupportingReference] = Field(default_factory=list)
    #: True when personality.md already describes this trait.
    already_described: bool = False


ConflictKind = Literal["direct_contradiction", "timeline_conflict", "source_uncertainty", "duplicate_assertion", "complementary"]


class Conflict(_Out):
    id: str
    kind: ConflictKind
    fact_id: str
    #: The other side: an existing lore line, or another proposed fact's id.
    existing: str
    other_fact_id: str | None = None
    note: str


class LoreComparison(_Out):
    """Proposal vs the pack's current lore.md (a regression reference, not proof of the source)."""

    recovered: list[str] = Field(default_factory=list)
    not_recovered: list[str] = Field(default_factory=list)
    new_fact_ids: list[str] = Field(default_factory=list)


class SourceInfo(_Out):
    name: str
    sha256: str
    page_count: int
    pages_analyzed: list[int]
    excluded_pages: list[int] = Field(default_factory=list)
    license: str | None = None
    url: str | None = None


class ProviderInfo(_Out):
    type: str
    model: str | None = None
    remote: bool


class ProposalSummary(_Out):
    chunks: int
    chunks_failed: int
    facts: int
    needs_review: int
    rejected: int
    duplicates_merged: int
    conflicts: int
    traits: int


class LoreProposal(_Out):
    id: str
    character_id: str
    character_name: str
    narrative_reference: str | None
    generated_at: str
    source: SourceInfo
    provider: ProviderInfo
    summary: ProposalSummary
    facts: list[ProposedFact]
    rejected_facts: list[ProposedFact]
    traits: list[ProposedTrait]
    rejected_traits: list[ProposedTrait]
    conflicts: list[Conflict]
    comparison: LoreComparison
    warnings: list[str] = Field(default_factory=list)
