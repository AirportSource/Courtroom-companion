"""Apply a user's review decisions to the knowledge overlay (D-102).

Only items the user names are applied; everything else in the proposal is left out (rejection is
the default). Guards:
- rejected items (evidence not found / invalid page) can never be approved
- facts in a direct contradiction or timeline conflict need explicit acknowledgement
- restatements of built-in lore or of already-approved items are skipped unless acknowledged
- user edits replace the model's wording and are recorded in the provenance
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .grounding import normalize
from .knowledge import (
    ApprovedFact,
    ApprovedTrait,
    CharacterKnowledge,
    Provenance,
    SourceRecord,
    now,
    plain_line,
)
from .schemas import LoreProposal

BLOCKING_CONFLICTS = frozenset({"direct_contradiction", "timeline_conflict"})


class ApprovalError(ValueError):
    def __init__(self, code: str, message: str, ids: list[str] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.ids = ids or []


@dataclass
class ApprovalResult:
    knowledge: CharacterKnowledge
    approved: list[str] = field(default_factory=list)
    skipped: list[dict[str, str]] = field(default_factory=list)


def _fact_key(subject: str, predicate: str, obj: str | None, evidence: str) -> tuple[str, ...]:
    return normalize(subject), normalize(predicate), normalize(obj or ""), normalize(evidence)


def apply_approval(
    proposal: LoreProposal,
    knowledge: CharacterKnowledge,
    fact_ids: list[str],
    trait_ids: list[str],
    edits: dict[str, str] | None = None,
    acknowledge: list[str] | None = None,
) -> ApprovalResult:
    edits = edits or {}
    acknowledged = set(acknowledge or [])
    facts = {f.id: f for f in proposal.facts}
    traits = {t.id: t for t in proposal.traits}
    rejected = {f.id for f in proposal.rejected_facts} | {t.id for t in proposal.rejected_traits}

    refused = [i for i in [*fact_ids, *trait_ids] if i in rejected]
    if refused:
        raise ApprovalError("rejected_item", "Rejected items (unsupported evidence) cannot be approved.", refused)
    unknown = [i for i in fact_ids if i not in facts] + [i for i in trait_ids if i not in traits]
    if unknown:
        raise ApprovalError("unknown_item", "Some items are not part of this proposal.", unknown)
    stray = [i for i in edits if i not in fact_ids and i not in trait_ids]
    if stray:
        raise ApprovalError("unknown_item", "Edits must refer to approved items.", stray)
    empty = [i for i, text in edits.items() if not plain_line(text)]
    if empty:
        raise ApprovalError("empty_edit", "Edited text cannot be empty.", empty)
    blocking = sorted({c.fact_id for c in proposal.conflicts if c.kind in BLOCKING_CONFLICTS
                       and c.fact_id in fact_ids and c.fact_id not in acknowledged})
    if blocking:
        raise ApprovalError("unacknowledged_conflict",
                            "These facts contradict existing or other proposed knowledge; acknowledge them to approve.", blocking)

    result = ApprovalResult(knowledge)
    approved_at = now()
    existing_keys = {_fact_key(f.subject, f.predicate, f.object, f.provenance.evidence) for f in knowledge.facts}
    existing_ids = {f.id for f in knowledge.facts} | {t.id for t in knowledge.traits}

    def provenance(item, edited: bool) -> Provenance:
        return Provenance(source_document=proposal.source.name, source_sha256=proposal.source.sha256,
                          source_pages=item.source_pages, evidence=item.evidence, proposal_id=proposal.id,
                          approved_at=approved_at, edited=edited)

    for fact_id in fact_ids:
        item = facts[fact_id]
        overlay_id = f"{proposal.id}-{item.id}"
        if overlay_id in existing_ids or _fact_key(item.subject, item.predicate, item.object, item.evidence) in existing_keys:
            result.skipped.append({"id": fact_id, "reason": "already_approved"})
            continue
        if item.matches_existing and fact_id not in acknowledged:
            result.skipped.append({"id": fact_id, "reason": "already_in_lore"})
            continue
        text = edits.get(fact_id)
        knowledge.facts.append(ApprovedFact(
            id=overlay_id, category=item.category, subject=plain_line(item.subject, 120),
            predicate=plain_line(item.predicate, 80), object=plain_line(item.object, 200) if item.object else None,
            description=plain_line(text if text is not None else item.description), basis=item.basis,
            provenance=provenance(item, text is not None)))
        result.approved.append(fact_id)

    for trait_id in trait_ids:
        item = traits[trait_id]
        overlay_id = f"{proposal.id}-{item.id}"
        if overlay_id in existing_ids:
            result.skipped.append({"id": trait_id, "reason": "already_approved"})
            continue
        if item.already_described and trait_id not in acknowledged:
            result.skipped.append({"id": trait_id, "reason": "already_in_personality"})
            continue
        text = edits.get(trait_id)
        knowledge.traits.append(ApprovedTrait(
            id=overlay_id, trait=plain_line(item.trait, 80), guidance=plain_line(text if text is not None else item.guidance),
            kind=item.kind, provenance=provenance(item, text is not None)))
        result.approved.append(trait_id)

    if result.approved and not any(s.sha256 == proposal.source.sha256 for s in knowledge.sources):
        knowledge.sources.append(SourceRecord(name=proposal.source.name, sha256=proposal.source.sha256,
                                              license=proposal.source.license, url=proposal.source.url,
                                              first_approved_at=approved_at))
    return result
