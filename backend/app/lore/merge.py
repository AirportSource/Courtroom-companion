"""Deduplication, conflict detection and comparison with existing pack files (D-101).

All deterministic. Conflicts are only represented, never resolved: Phase D's human review decides.

Deduplication key: category-independent (subject, predicate, object) after entity and predicate
normalisation (aliases, surnames, synonyms, symmetric relations). Facts without an object merge
only when their descriptions are near-identical, so distinct events between the same people stay
separate.

Conflict kinds:
- `duplicate_assertion`: the fact restates an existing lore line (kept, marked as known)
- `direct_contradiction`: same subject and single-valued predicate family (upbringing, parents,
  birth ...) with a different object, against another proposed fact or an existing lore line
- `timeline_conflict`: same subject/predicate family but different years
- `source_uncertainty`: the fact touches something the lore lists as uncertain, or the model
  itself marked it uncertain
- `complementary`: shares people with existing lore and adds detail (informational)
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .grounding import normalize
from .schemas import Conflict, ProposedFact, ProposedTrait, SupportingReference

STOPWORDS = frozenset("""a an and are as at be been but by for from had has have he her hers him his i in into is it
its of on or she so than that the their them then there they this to was were what when where which while who whom
with would after before during also not no very""".split())

#: Predicate synonyms -> canonical predicate.
PREDICATE_SYNONYMS = {
    "twin_of": "twin_sister_of", "twin": "twin_sister_of", "is_twin_of": "twin_sister_of",
    "twin_sister": "twin_sister_of", "is_twin_sister_of": "twin_sister_of",
    "grew_up_at": "raised_at", "grew_up_in": "raised_at", "raised_in": "raised_at", "brought_up_at": "raised_at",
    "brought_up_by": "raised_by", "was_raised_by": "raised_by", "was_raised_at": "raised_at",
    "daughter_of": "child_of", "son_of": "child_of", "is_daughter_of": "child_of",
    "has_mother": "mother", "mother_is": "mother", "has_father": "father", "father_is": "father",
    "was_born_in": "born_in", "birthplace": "born_in", "born_at": "born_in",
}
#: Symmetric relations: (A, rel, B) == (B, rel, A).
SYMMETRIC = frozenset({"twin_sister_of", "sibling_of", "sister_of", "brother_of", "cousin_of", "married_to",
                       "friend_of", "dated", "in_relationship_with"})
#: Predicate families where one subject has one value; a different value is a contradiction.
SINGLE_VALUED = {
    "raised_at": "upbringing", "raised_by": "upbringing_guardian", "born_in": "birth_place",
    "birth_year": "birth_year", "mother": "mother", "father": "father", "child_of": "parents",
}
#: Words in an existing lore line that signal the same family as a predicate.
FAMILY_KEYWORDS = {
    "upbringing": ("raised", "grew up", "brought up", "upbringing"),
    "upbringing_guardian": ("raised", "brought up"),
    "birth_place": ("born in", "birthplace"),
    "birth_year": ("born", "birth"),
    "mother": ("mother",),
    "father": ("father",),
    "parents": ("mother", "father", "daughter of", "son of"),
}
YEAR = re.compile(r"\b(1[5-9]\d\d|2[01]\d\d)\b")


def _stem(word: str) -> str:
    return word[:-1] if len(word) > 3 and word.endswith("s") and not word.endswith("ss") else word


def words(text: str) -> set[str]:
    """Content words for overlap scores (stopwords dropped, plural -s stripped)."""
    return {_stem(w.strip("'")) for w in normalize(text).split() if w not in STOPWORDS and len(w.strip("'")) > 1}


def jaccard(a: set[str], b: set[str]) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def containment(part: set[str], whole: set[str]) -> float:
    """Share of `part` found in `whole`."""
    return len(part & whole) / len(part) if part and whole else 0.0


#: A fact whose words are this contained in an existing lore line restates it.
DUPLICATE_CONTAINMENT = 0.6
COMPLEMENTARY_CONTAINMENT = 0.3


def canonical_predicate(predicate: str) -> str:
    key = re.sub(r"[^a-z0-9]+", "_", predicate.casefold()).strip("_")
    return PREDICATE_SYNONYMS.get(key, key)


class EntityResolver:
    """Maps aliases, titles and lone surnames/first names to one canonical full name."""

    def __init__(self, character_names: list[str], facts: list[ProposedFact]) -> None:
        self.full_names: set[str] = set()
        for name in [*character_names, *(f.subject for f in facts), *(f.object or "" for f in facts)]:
            cleaned = self._strip(name)
            # Only proper names count ("Dahlia Hawthorne", "Miles Edgeworth", "Franziska von Karma"),
            # never descriptive objects like "betraying Dahlia and deceiving Wright".
            capitalised = all(w[:1].isupper() or w in ("von", "de", "van", "of", "la", "le") for w in name.split())
            if 2 <= len(cleaned.split()) <= 4 and capitalised:
                self.full_names.add(cleaned)
        self.primary = self._strip(character_names[0]) if character_names else ""
        self.aliases = {self._strip(n): self.primary for n in character_names if n}

    @staticmethod
    def _strip(name: str) -> str:
        name = normalize(name)
        return re.sub(r"^(sister|brother|mr|mrs|ms|miss|dr|detective|prosecutor|attorney|master)\s+", "", name)

    def resolve(self, name: str | None) -> str:
        if not name:
            return ""
        key = self._strip(name)
        if key in self.aliases:
            return self.aliases[key]
        if " of " in key and key.split(" of ")[0] in self.aliases:  # "Iris of Hazakura Temple"
            return self.aliases[key.split(" of ")[0]]
        if len(key.split()) == 1:
            matches = sorted(n for n in self.full_names if key in n.split())
            if len(matches) == 1:
                return matches[0]
        return key


@dataclass
class LoreLine:
    section: str
    text: str
    uncertain: bool


def parse_lore(lore: str) -> list[LoreLine]:
    """Bullet statements of a lore.md (continuation lines joined), with their section."""
    lines: list[LoreLine] = []
    section = ""
    for raw in lore.splitlines():
        if raw.startswith("#"):
            section = raw.lstrip("#").strip()
        elif raw.lstrip().startswith("- "):
            lines.append(LoreLine(section, raw.strip()[2:].strip(), "uncertain" in section.casefold()))
        elif raw.startswith("  ") and lines and raw.strip():
            lines[-1].text += " " + raw.strip()
    return lines


def _content(fact: ProposedFact) -> set[str]:
    return words(" ".join(filter(None, [fact.subject, fact.predicate, fact.object, fact.description])))


def deduplicate(facts: list[ProposedFact], resolver: EntityResolver) -> tuple[list[ProposedFact], int]:
    """Merge restatements. Better-grounded facts win; the others become supporting references."""
    rank = {"verified": 0, "fuzzy": 1, "other_page": 2}
    ordered = sorted(facts, key=lambda f: (f.review_status != "proposed", rank.get(f.evidence_check.status, 3)))
    kept: list[ProposedFact] = []
    keys: dict[tuple, ProposedFact] = {}
    merged = 0
    for fact in ordered:
        subject, obj = resolver.resolve(fact.subject), resolver.resolve(fact.object)
        predicate = canonical_predicate(fact.predicate)
        if obj and predicate in SYMMETRIC:
            subject, obj = sorted((subject, obj))
        key = (subject, predicate, obj) if obj else None
        target = keys.get(key) if key else None
        if target is None:
            target = next((k for k in kept if resolver.resolve(k.subject) == subject
                           and canonical_predicate(k.predicate) == predicate
                           and jaccard(_content(k), _content(fact)) >= 0.75), None)
        if target is not None:
            target.also_supported_by.append(SupportingReference(pages=fact.source_pages, evidence=fact.evidence))
            target.source_pages = sorted(set(target.source_pages) | set(fact.source_pages))
            merged += 1
            continue
        kept.append(fact)
        if key:
            keys[key] = fact
    kept.sort(key=lambda f: (min(f.source_pages), f.id))
    return kept, merged


def _family(fact: ProposedFact) -> str | None:
    return SINGLE_VALUED.get(canonical_predicate(fact.predicate))


def detect_conflicts(facts: list[ProposedFact], existing: list[LoreLine], resolver: EntityResolver) -> list[Conflict]:
    conflicts: list[Conflict] = []

    seen: set[tuple[str, str]] = set()

    def add(kind, fact, other_text, note, other_id=None):
        if (kind, fact.id) in seen:
            return
        seen.add((kind, fact.id))
        conflicts.append(Conflict(id=f"c{len(conflicts) + 1}", kind=kind, fact_id=fact.id, existing=other_text,
                                  other_fact_id=other_id, note=note))

    # Between proposed facts (two sources, or two passages, disagree).
    for i, a in enumerate(facts):
        family = _family(a)
        if family is None or not a.object:
            continue
        for b in facts[i + 1:]:
            if _family(b) != family or resolver.resolve(a.subject) != resolver.resolve(b.subject) or not b.object:
                continue
            if resolver.resolve(a.object) == resolver.resolve(b.object):
                continue
            years_a, years_b = set(YEAR.findall(a.object)), set(YEAR.findall(b.object))
            kind = "timeline_conflict" if years_a and years_b else "direct_contradiction"
            add(kind, a, b.description, f"Both state the {family.replace('_', ' ')} of {a.subject} differently.", b.id)

    # Against existing lore. Lore lines are long, multi-fact and use pronouns for the character, so
    # the score is the share of the fact's words found in the line (plus its section heading), with
    # the character's own name ignored on both sides.
    self_words = words(" ".join(resolver.aliases)) | words(resolver.primary)
    line_words = [words(f"{line.section} {line.text}") - self_words for line in existing]
    for fact in facts:
        fact_words = _content(fact) - self_words
        subject = resolver.resolve(fact.subject)
        subject_words = words(subject) - self_words
        object_words = (words(resolver.resolve(fact.object)) - self_words) if fact.object else set()
        scored = [(containment(fact_words, lw), line, lw) for line, lw in zip(existing, line_words)]
        certain = [item for item in scored if not item[1].uncertain]
        best_score, best, _ = max(certain, key=lambda item: item[0], default=(0.0, None, None))
        uncertain = max((item for item in scored if item[1].uncertain), key=lambda item: item[0], default=None)
        if uncertain is not None and uncertain[0] >= 0.4:
            add("source_uncertainty", fact, uncertain[1].text, "The current lore lists this as uncertain or not covered.")
        if fact.basis == "uncertain":
            add("source_uncertainty", fact, best.text if best else "", "The source itself presents this as uncertain.")
        if best is not None and best_score >= DUPLICATE_CONTAINMENT:
            fact.matches_existing.append(best.text)
            add("duplicate_assertion", fact, best.text, "Already stated in the current lore.")
            continue
        family = _family(fact)
        contradiction = None
        for line, lw in zip(existing, line_words):
            text = normalize(line.text)
            about_subject = subject in (resolver.primary, "") or bool(subject_words & lw)
            if family and not line.uncertain and about_subject and any(k in text for k in FAMILY_KEYWORDS[family]):
                if object_words and not object_words & lw:
                    contradiction = line
                    break
        if contradiction is not None:
            years_fact = set(YEAR.findall(fact.object or "")) | set(YEAR.findall(fact.description))
            years_line = set(YEAR.findall(contradiction.text))
            kind = "timeline_conflict" if years_fact and years_line and not years_fact & years_line else "direct_contradiction"
            add(kind, fact, contradiction.text, "The current lore states a different value; review before applying.")
        elif best is not None and best_score >= COMPLEMENTARY_CONTAINMENT:
            add("complementary", fact, best.text, "Adds detail to an existing lore line.")
    return conflicts


#: Absolute directives turn nuance into caricature ("always apologises").
ABSOLUTE = re.compile(r"\b(always|never|constantly|every time|at all times|in every)\b", re.I)
#: A long quoted passage in generated guidance suggests copied or invented dialogue.
LONG_QUOTE = re.compile(r"[\"“«]([^\"”»]{90,})[\"”»]")


def review_traits(traits: list[ProposedTrait], personality: str) -> tuple[list[ProposedTrait], int]:
    """Merge repeated traits, flag caricature/dialogue risks and traits personality.md already has."""
    kept: list[ProposedTrait] = []
    merged = 0
    personality_words = words(personality)
    for trait in traits:
        name = normalize(trait.trait)
        twin = next((k for k in kept if normalize(k.trait) == name
                     or jaccard(words(k.trait + " " + k.guidance), words(trait.trait + " " + trait.guidance)) >= 0.6), None)
        if twin is not None:
            twin.also_supported_by.append(SupportingReference(pages=trait.source_pages, evidence=trait.evidence))
            twin.source_pages = sorted(set(twin.source_pages) | set(trait.source_pages))
            merged += 1
            continue
        if ABSOLUTE.search(trait.guidance):
            trait.flags.append("absolute_directive")
        if LONG_QUOTE.search(trait.guidance):
            trait.flags.append("quoted_dialogue")
        if trait.flags and trait.review_status == "proposed":
            trait.review_status = "needs_review"
        trait.already_described = containment(words(trait.trait), personality_words) >= 0.6
        kept.append(trait)
    return kept, merged
