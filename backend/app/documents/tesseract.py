r"""Local OCR through the Tesseract command-line executable (D-100).

Tesseract only recognises text; it never interprets it. Nothing here touches the network, and no
installer is ever downloaded or run. The executable is discovered, first match wins:

1. ``COURTROOM_TESSERACT_PATH`` (explicit; if it points nowhere that is an error, not a fallback)
2. a bundled copy: ``<resource root>/tesseract/tesseract.exe`` (``tesseract`` elsewhere) — in
   development the resource root is the repository, in a frozen build it is the bundle
3. ``tesseract`` on PATH
4. standard Windows installs: ``%ProgramFiles%\Tesseract-OCR`` and
   ``%LOCALAPPDATA%\Programs\Tesseract-OCR``

Language data (``eng.traineddata`` ...) comes from ``TESSDATA_PREFIX`` when set, else from a
``tessdata`` folder beside a bundled executable, else Tesseract's own default.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path

from ..runtime import paths as runtime_paths

TESSERACT_ENV = "COURTROOM_TESSERACT_PATH"

#: Tesseract language codes the importer offers. English and French first; Japanese is optional
#: and only works when ``jpn.traineddata`` is installed.
SUPPORTED_LANGUAGES = {"eng": "English", "fra": "French", "jpn": "Japanese"}
DEFAULT_LANGUAGES = ("eng", "fra")

INSTALL_HINT = (
    "Install Tesseract OCR 5 for Windows (for example the UB Mannheim build), then restart the app, "
    f"or set {TESSERACT_ENV} to the full path of tesseract.exe. A bundled copy is also accepted in a "
    "'tesseract' folder next to the application resources (tesseract.exe plus a tessdata folder)."
)
LANGUAGE_HINT = (
    "Download the missing <language>.traineddata files from the tesseract-ocr/tessdata_fast or tessdata "
    "repository into Tesseract's tessdata folder (or the folder named by TESSDATA_PREFIX)."
)


class OcrError(Exception):
    code = "ocr_failed"


class TesseractNotFoundError(OcrError):
    code = "tesseract_missing"


class LanguageDataMissingError(OcrError):
    code = "language_data_missing"

    def __init__(self, missing: list[str], available: list[str]) -> None:
        self.missing = missing
        self.available = available
        super().__init__(
            f"Tesseract language data missing for: {', '.join(missing)} "
            f"(installed: {', '.join(available) or 'none'}). {LANGUAGE_HINT}")


class OcrTimeoutError(OcrError):
    code = "ocr_timeout"


class OcrFailedError(OcrError):
    code = "ocr_failed"


@dataclass(frozen=True)
class RunResult:
    returncode: int
    stdout: bytes
    stderr: bytes


#: (argv, timeout seconds, extra environment) -> RunResult. Replaceable in tests.
Runner = Callable[[list[str], float, dict[str, str]], RunResult]


def run_subprocess(argv: list[str], timeout: float, extra_env: dict[str, str]) -> RunResult:
    env = {**os.environ, **extra_env}
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0
    try:
        done = subprocess.run(argv, capture_output=True, stdin=subprocess.DEVNULL, timeout=timeout,
                              env=env, creationflags=flags, check=False)
    except subprocess.TimeoutExpired:
        raise OcrTimeoutError(f"Tesseract did not finish within {timeout:.0f} s") from None
    except OSError as error:
        raise TesseractNotFoundError(f"Tesseract could not be started ({type(error).__name__}). {INSTALL_HINT}") from None
    return RunResult(done.returncode, done.stdout, done.stderr)


@dataclass(frozen=True)
class Discovery:
    executable: Path
    #: "env" | "bundled" | "path" | "standard_install"
    source: str
    tessdata: Path | None = None


def _exe_name() -> str:
    return "tesseract.exe" if sys.platform == "win32" else "tesseract"


def _standard_installs() -> Iterable[Path]:
    if sys.platform != "win32":
        return []
    roots = [os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)")]
    local = os.environ.get("LOCALAPPDATA")
    candidates = [Path(r) / "Tesseract-OCR" for r in roots if r]
    if local:
        candidates.append(Path(local) / "Programs" / "Tesseract-OCR")
    return [c / _exe_name() for c in candidates]


def discover(which: Callable[[str], str | None] = shutil.which) -> Discovery:
    """Find the executable or raise TesseractNotFoundError. Never downloads or installs anything."""
    explicit = os.environ.get(TESSERACT_ENV)
    if explicit:
        path = Path(explicit)
        if path.is_file():
            return Discovery(path, "env")
        raise TesseractNotFoundError(f"{TESSERACT_ENV} points to a missing file. {INSTALL_HINT}")
    bundled = runtime_paths.resource_root() / "tesseract" / _exe_name()
    if bundled.is_file():
        tessdata = bundled.parent / "tessdata"
        return Discovery(bundled, "bundled", tessdata if tessdata.is_dir() else None)
    on_path = which("tesseract")
    if on_path:
        return Discovery(Path(on_path), "path")
    for candidate in _standard_installs():
        if candidate.is_file():
            return Discovery(candidate, "standard_install")
    raise TesseractNotFoundError(f"Tesseract OCR was not found. {INSTALL_HINT}")


@dataclass(frozen=True)
class OcrResult:
    text: str
    #: Mean word confidence 0-100 reported by Tesseract (recognition certainty, not factual truth).
    confidence: float | None
    word_count: int


#: A horizontal gap wider than this many line heights splits a Tesseract line into fragments: on
#: web-page prints Tesseract often merges a sidebar/infobox column into body lines (D-100, Iris.pdf).
COLUMN_GAP_FACTOR = 2.5


@dataclass
class _Fragment:
    par: int
    line: int
    x0: int
    x1: int
    words: list[str]


def _columns(fragments: list[_Fragment]) -> list[list[_Fragment]]:
    """Group a block's fragments into columns: fragments that overlap horizontally share a column."""
    groups: list[list[_Fragment]] = []
    for fragment in sorted(fragments, key=lambda f: f.x0):
        overlapping = [g for g in groups if any(f.x0 < fragment.x1 and fragment.x0 < f.x1 for f in g)]
        merged = [fragment] + [f for g in overlapping for f in g]
        groups = [g for g in groups if g not in overlapping] + [merged]
    return sorted((sorted(g, key=lambda f: (f.par, f.line, f.x0)) for g in groups), key=lambda g: min(f.x0 for f in g))


def parse_tsv(tsv: str) -> OcrResult:
    """Rebuild text from Tesseract TSV.

    Words are joined per line; a line is split where a gap marks another column, and each block's
    columns are written one after another (left first). Blank lines separate paragraphs, columns
    and blocks. Text is never altered, only ordered.
    """
    lines_by_key: dict[tuple[int, int, int, int], list[tuple[int, int, int, str]]] = {}
    confidences: list[float] = []
    rows = tsv.splitlines()
    for row in rows[1:] if rows and rows[0].startswith("level") else rows:
        cols = row.split("\t")
        if len(cols) < 12 or cols[0] != "5":
            continue
        word = cols[11].strip()
        if not word:
            continue
        try:
            key = (int(cols[1]), int(cols[2]), int(cols[3]), int(cols[4]))
            left, width, height = int(cols[6]), int(cols[8]), int(cols[9])
            conf = float(cols[10])
        except ValueError:
            continue
        lines_by_key.setdefault(key, []).append((left, width, height, word))
        if conf >= 0:
            confidences.append(conf)

    blocks: dict[tuple[int, int], list[_Fragment]] = {}
    for (page, block, par, line), words in lines_by_key.items():
        words.sort(key=lambda w: w[0])
        heights = sorted(h for _, _, h, _ in words)
        gap_limit = COLUMN_GAP_FACTOR * max(1, heights[len(heights) // 2])
        current: _Fragment | None = None
        for left, width, _, word in words:
            if current is None or left - current.x1 > gap_limit:
                current = _Fragment(par, line, left, left + width, [])
                blocks.setdefault((page, block), []).append(current)
            current.words.append(word)
            current.x1 = max(current.x1, left + width)

    sections: list[str] = []
    for _, fragments in sorted(blocks.items()):
        for column in _columns(fragments):
            out: list[str] = []
            for previous, fragment in zip([None, *column], column):
                if previous is not None and previous.par != fragment.par:
                    out.append("")
                out.append(" ".join(fragment.words))
            sections.append("\n".join(out))
    words_total = sum(len(w) for w in lines_by_key.values())
    return OcrResult("\n\n".join(sections), round(sum(confidences) / len(confidences), 1) if confidences else None,
                     words_total)


def _decode(data: bytes) -> str:
    return data.decode("utf-8", errors="replace")


class TesseractEngine:
    def __init__(self, discovery: Discovery, runner: Runner = run_subprocess, query_timeout_s: float = 20) -> None:
        self.discovery = discovery
        self.runner = runner
        self.query_timeout_s = query_timeout_s
        self._languages: list[str] | None = None
        self._version: str | None = None

    @classmethod
    def discover(cls, runner: Runner = run_subprocess) -> TesseractEngine:
        return cls(discover(), runner)

    @property
    def _env(self) -> dict[str, str]:
        if self.discovery.tessdata and "TESSDATA_PREFIX" not in os.environ:
            return {"TESSDATA_PREFIX": str(self.discovery.tessdata)}
        return {}

    def _run(self, args: list[str], timeout: float) -> RunResult:
        return self.runner([str(self.discovery.executable), *args], timeout, self._env)

    def version(self) -> str:
        if self._version is None:
            result = self._run(["--version"], self.query_timeout_s)
            match = re.search(r"tesseract\s+v?(\d+\.\d+[\w.\-]*)", _decode(result.stdout + result.stderr), re.I)
            self._version = match.group(1) if match else "unknown"
        return self._version

    def languages(self) -> list[str]:
        if self._languages is None:
            result = self._run(["--list-langs"], self.query_timeout_s)
            if result.returncode != 0:
                raise OcrFailedError("Tesseract could not list its installed languages")
            out = _decode(result.stdout + b"\n" + result.stderr)
            self._languages = sorted({line.strip() for line in out.splitlines()
                                      if re.fullmatch(r"[A-Za-z0-9_]+", line.strip() or "-")})
        return self._languages

    def require_languages(self, languages: Iterable[str]) -> None:
        available = self.languages()
        missing = [lang for lang in languages if lang not in available]
        if missing:
            raise LanguageDataMissingError(missing, [a for a in available if a != "osd"])

    def recognize(self, image: Path, languages: Iterable[str], timeout_s: float) -> OcrResult:
        langs = list(languages)
        self.require_languages(langs)
        result = self._run([str(image), "stdout", "-l", "+".join(langs), "tsv"], timeout_s)
        if result.returncode != 0:
            detail = _decode(result.stderr).strip().splitlines()[-1:] or ["no detail"]
            raise OcrFailedError(f"Tesseract failed (exit {result.returncode}): {detail[0][:200]}")
        return parse_tsv(_decode(result.stdout))
