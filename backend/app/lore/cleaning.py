"""Deterministic document cleaning and chunking before LLM analysis (D-101).

Cleaning works line by line on each page's extracted text and never edits a kept line. Every
removed line is recorded with the rule that removed it, so the cleaned view is reversible and the
original extraction stays untouched. Rules are generic (site chrome, repeated headers/footers,
OCR noise), not tied to one character or wiki:

- `site_chrome`: whole lines that are web UI controls (sign-in, navigation menu entries ...)
- `repeated`: a line on at least half the pages (>= 3) — running headers, footers, menus
- `page_furniture`: print headers (date/time stamps), bare URLs, page counters like "3/8"
- `ocr_noise`: lines with fewer than 3 letters
- `footer_widget`: everything after a known site-footer marker on a page

Section headings are kept and remembered, so later chunks still know their section. A licence
notice ("Community content is available under CC-BY-SA") is captured as metadata before removal.

Chunks group whole paragraphs, in page order, up to a character limit; each chunk carries its pages.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

#: Whole-line UI controls of common wiki/web layouts (compared case-insensitively, trimmed).
SITE_CHROME = frozenset({
    "home", "explore", "saved", "progress", "history", "utilities", "settings", "more", "search",
    "sign in", "sign up", "log in", "create free account", "register now", "join the conversation",
    "sign in with google", "view mobile site", "download on the", "app store", "get it on", "google play",
    "[expand]", "categories", "languages", "images", "animations", "edit", "share", "advertisement",
    "sign in to read what others are saying and share your thoughts.", "don't have account? register now",
})
#: A line starting with one of these ends the useful content of its page.
FOOTER_MARKERS = ("explore properties", "follow us", "fandom apps", "take your favorite fandoms",
                  "join the conversation")
LICENSE_PATTERN = re.compile(r"content is available under\s+(CC[- ]BY(?:[- ]SA)?(?:[- ]\d\.\d)?|[A-Z][\w.-]*(?: [A-Z][\w.-]*){0,4})", re.I)
URL_ONLY = re.compile(r"^\S*https?://\S+(\s+\d+\s*/\s*\d+)?$", re.I)
DATE_STAMP = re.compile(r"^\d{1,2}/\d{1,2}/\d{2,4}\s+\d{1,2}:\d{2}\b")
PAGE_COUNTER = re.compile(r"^\d{1,3}\s*/\s*\d{1,3}$")
HEADING = re.compile(r"^[A-Z0-9][^.!?:;]{1,60}$")

DEFAULT_CHUNK_CHARS = 6000
#: Analysis stops adding pages beyond this many cleaned characters; skipped pages are reported.
DEFAULT_MAX_SOURCE_CHARS = 60000


@dataclass
class RemovedLine:
    page: int
    text: str
    rule: str


@dataclass
class Segment:
    """A cleaned paragraph with its provenance."""

    page: int
    text: str
    section: str | None = None


@dataclass
class CleanedDocument:
    pages: dict[int, str]
    segments: list[Segment]
    removed: list[RemovedLine] = field(default_factory=list)
    license: str | None = None
    url: str | None = None

    def to_json(self) -> dict:
        return {
            "license": self.license,
            "url": self.url,
            "pages": [{"page": p, "text": t} for p, t in sorted(self.pages.items())],
            "removed": [{"page": r.page, "text": r.text, "rule": r.rule} for r in self.removed],
        }


def _key(line: str) -> str:
    return re.sub(r"\s+", " ", line).strip().casefold()


def _letters(line: str) -> int:
    return sum(ch.isalpha() for ch in line)


def clean_pages(pages: dict[int, str]) -> CleanedDocument:
    """Clean page texts (page number -> original text)."""
    line_pages: Counter[str] = Counter()
    for text in pages.values():
        line_pages.update({_key(line) for line in text.splitlines() if _key(line)})
    repeat_threshold = max(3, (len(pages) + 1) // 2)

    removed: list[RemovedLine] = []
    cleaned: dict[int, str] = {}
    license_text, url = None, None
    for number, text in sorted(pages.items()):
        kept: list[str] = []
        footer = False
        for line in text.splitlines():
            key = _key(line)
            if not key:
                kept.append("")
                continue
            match = LICENSE_PATTERN.search(line)
            if match and license_text is None:
                license_text = match.group(1).strip()
            found_url = re.search(r"https?://\S+", line)
            if found_url and url is None and URL_ONLY.match(line.strip()):
                url = found_url.group(0)
            rule = None
            if footer or key.startswith(FOOTER_MARKERS):
                footer, rule = True, "footer_widget"
            elif match:
                rule = "page_furniture"
            elif key in SITE_CHROME:
                rule = "site_chrome"
            elif URL_ONLY.match(line.strip()) or DATE_STAMP.match(line.strip()) or PAGE_COUNTER.match(line.strip()):
                rule = "page_furniture"
            elif line_pages[key] >= repeat_threshold:
                rule = "repeated"
            elif _letters(line) < 3:
                rule = "ocr_noise"
            if rule:
                removed.append(RemovedLine(number, line.strip(), rule))
            else:
                kept.append(line.rstrip())
        cleaned[number] = re.sub(r"\n{3,}", "\n\n", "\n".join(kept)).strip()
    return CleanedDocument(cleaned, _segments(cleaned), removed, license_text, url)


CONTENTS_ENTRY = re.compile(r"^\s*\d{0,2}\s*\.\s*([A-Z].{1,60})$")
SMALL_WORDS = frozenset({"a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"})


def _contents_titles(pages: dict[int, str]) -> set[str]:
    """Section names listed in the document's own table of contents ("1. The abandoned twin")."""
    titles = set()
    for text in pages.values():
        for line in text.splitlines():
            match = CONTENTS_ENTRY.match(line)
            if match:
                titles.add(_key(match.group(1)))
    return titles


def _looks_like_heading(line: str, following: str | None) -> bool:
    words = line.split()
    if not (HEADING.match(line) and 1 <= len(words) <= 5):
        return False
    titled = all(w[0].isupper() or w.casefold() in SMALL_WORDS for w in words if w[0].isalpha())
    return titled and following is not None and len(following) >= 120 and following[:1].isupper()


def _segments(pages: dict[int, str]) -> list[Segment]:
    """Paragraphs with their page and section. A one-line paragraph is a heading when it appears in
    the document's contents list, or when it is short, title-cased and introduces a real paragraph
    (infobox fragments and OCR leftovers are not headings)."""
    titles = _contents_titles(pages)
    segments: list[Segment] = []
    section: str | None = None
    for number, text in sorted(pages.items()):
        paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
        for index, paragraph in enumerate(paragraphs):
            lines = paragraph.splitlines()
            following = paragraphs[index + 1] if index + 1 < len(paragraphs) else None
            if len(lines) == 1 and not CONTENTS_ENTRY.match(lines[0]) and (
                    _key(lines[0]) in titles or _looks_like_heading(lines[0].strip(), following)):
                section = lines[0].strip()
            segments.append(Segment(number, paragraph, section))
    return segments


@dataclass
class Chunk:
    index: int
    segments: list[Segment]

    @property
    def pages(self) -> list[int]:
        return sorted({s.page for s in self.segments})

    def render(self) -> str:
        """Text for the model, with page and section markers so citations can be checked."""
        out, page, section = [], None, None
        for segment in self.segments:
            if segment.page != page or segment.section != section:
                page, section = segment.page, segment.section
                out.append(f"[Page {page}" + (f" | Section: {section}]" if section else "]"))
            out.append(segment.text)
        return "\n\n".join(out)


def chunk_segments(segments: list[Segment], chunk_chars: int = DEFAULT_CHUNK_CHARS,
                   max_source_chars: int = DEFAULT_MAX_SOURCE_CHARS) -> tuple[list[Chunk], list[int]]:
    """Group whole paragraphs into chunks. Returns (chunks, pages excluded by `max_source_chars`).

    A page is either analysed completely or excluded completely, never cut in the middle.
    """
    by_page: dict[int, list[Segment]] = {}
    for segment in segments:
        by_page.setdefault(segment.page, []).append(segment)
    included: list[Segment] = []
    excluded: list[int] = []
    total = 0
    for page, page_segments in sorted(by_page.items()):
        size = sum(len(s.text) for s in page_segments)
        if excluded or total + size > max_source_chars:
            excluded.append(page)
            continue
        included.extend(page_segments)
        total += size

    chunks: list[Chunk] = []
    current: list[Segment] = []
    size = 0
    for segment in included:
        for piece in _split_long(segment, chunk_chars):
            if current and size + len(piece.text) > chunk_chars:
                chunks.append(Chunk(len(chunks), current))
                current, size = [], 0
            current.append(piece)
            size += len(piece.text)
    if current:
        chunks.append(Chunk(len(chunks), current))
    return chunks, excluded


def _split_long(segment: Segment, limit: int) -> list[Segment]:
    if len(segment.text) <= limit:
        return [segment]
    pieces, current = [], ""
    for sentence in re.split(r"(?<=[.!?])\s+", segment.text):
        if current and len(current) + len(sentence) + 1 > limit:
            pieces.append(current)
            current = ""
        current = f"{current} {sentence}".strip()
    if current:
        pieces.append(current)
    return [Segment(segment.page, p, segment.section) for p in pieces]
