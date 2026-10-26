"""Check model citations against the extracted text (D-101). A citation is never trusted as given.

Evidence is compared after normalisation that tolerates OCR and typography differences (case,
Unicode compatibility forms, curly vs straight quotes, dashes, hyphenation at line ends,
whitespace). Outcomes:

- `verified`: the evidence occurs on a cited page
- `fuzzy`: a passage on a cited page matches at >= FUZZY_THRESHOLD (minor OCR differences)
- `other_page`: found on a page that was not cited (pages are corrected, review required)
- `not_found`: nowhere in the document -> the claim is rejected
- `invalid_page`: every cited page is outside the document -> rejected
"""

from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher

from .schemas import EvidenceCheck

FUZZY_THRESHOLD = 0.85
#: Evidence shorter than this (after normalisation) cannot prove anything on its own.
MIN_EVIDENCE_CHARS = 12

_PUNCT = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "«": '"', "»": '"',
                        "–": "-", "—": "-", "…": "..."})


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).translate(_PUNCT).casefold()
    text = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", text)  # hyphenation across lines
    text = re.sub(r"[^\w']+", " ", text.replace("_", " "))  # dashes, quotes, symbols -> spaces
    return re.sub(r"\s+", " ", text).strip()


def _fuzzy_score(needle: str, haystack: str) -> float:
    """Share of the evidence's characters found, in order, in a window of the page.

    Windows may be up to 1.5x the evidence length, so OCR noise inserted mid-sentence (an image
    caption or infobox fragment on the same line) does not hide a real quotation; misspellings
    lower the score. Evidence much longer than any page passage cannot score well.
    """
    words, page_words = needle.split(), haystack.split()
    if not words or len(page_words) < len(words) // 2:
        return 0.0
    size = len(words)
    best = 0.0
    for start in range(0, max(1, len(page_words) - size + 1)):
        if page_words[start][:1] != words[0][:1] and SequenceMatcher(None, words[0], page_words[start]).ratio() < 0.6:
            continue  # a window must start near the evidence's first word
        for extra in (0, size // 4, size // 2):
            window = " ".join(page_words[start:start + size + extra])
            matcher = SequenceMatcher(None, needle, window, autojunk=False)
            score = sum(block.size for block in matcher.get_matching_blocks()) / len(needle)
            if extra:
                score -= 0.02  # prefer the tight window on ties
            if score > best:
                best = score
        if best >= 0.99:
            break
    return round(min(best, 1.0), 3)


class Grounder:
    def __init__(self, pages: dict[int, str]) -> None:
        self.pages = {number: normalize(text) for number, text in pages.items()}

    def check(self, evidence: str, cited: list[int]) -> EvidenceCheck:
        needle = normalize(evidence)
        valid = [p for p in dict.fromkeys(cited) if p in self.pages]
        if not valid:
            return EvidenceCheck(status="invalid_page")
        if len(needle) < MIN_EVIDENCE_CHARS:
            return EvidenceCheck(status="not_found")
        for page in valid:
            if needle in self.pages[page]:
                return EvidenceCheck(status="verified", page=page, score=1.0)
        if len(valid) > 1 and needle in " ".join(self.pages[p] for p in sorted(valid)):
            return EvidenceCheck(status="verified", page=min(valid), score=1.0)  # spans a page break
        best_page, best = max(((p, _fuzzy_score(needle, self.pages[p])) for p in valid), key=lambda item: item[1])
        if best >= FUZZY_THRESHOLD:
            return EvidenceCheck(status="fuzzy", page=best_page, score=best)
        for page, text in self.pages.items():
            if page not in valid and (needle in text or _fuzzy_score(needle, text) >= FUZZY_THRESHOLD):
                return EvidenceCheck(status="other_page", page=page, score=1.0 if needle in text else FUZZY_THRESHOLD)
        return EvidenceCheck(status="not_found", score=best)
