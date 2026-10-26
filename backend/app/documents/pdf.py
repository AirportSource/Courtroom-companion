"""Hybrid PDF text extraction, page by page (D-100).

Each page first gets its native text layer (pypdf). Only pages without usable text are rendered
(pypdfium2, grayscale) and passed to local OCR, so a mixed PDF never OCRs its text pages. Callers
can force OCR on chosen pages when a text layer exists but is garbage.

Every page keeps its 1-based number and its original extracted text; nothing is cleaned here
(cleaning is a later, reversible stage). Failures stay in the report per page instead of being
hidden. Imported documents are untrusted data: they are only parsed, never executed, and rendered
page images live in a temporary directory removed when extraction ends.
"""

from __future__ import annotations

import hashlib
import io
import logging
import tempfile
import threading
import time
from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Protocol

from .tesseract import DEFAULT_LANGUAGES, SUPPORTED_LANGUAGES, OcrError, OcrResult

logger = logging.getLogger(__name__)

MAX_PDF_BYTES = 30 * 1024 * 1024
MAX_PAGES = 80
#: Wall-clock limit for one document; pages not reached in time are reported as skipped.
DOCUMENT_TIMEOUT_S = 600.0
PAGE_OCR_TIMEOUT_S = 90.0
OCR_DPI = 300
#: Rendered pages are scaled down to stay under this many pixels (huge page sizes).
MAX_RENDER_PIXELS = 25_000_000
#: A text layer with fewer letters/digits than this is treated as missing (scanned page).
MIN_TEXT_CHARS = 25
#: Below this many letters/digits, a page that also carries images is OCR'd as well.
SPARSE_TEXT_CHARS = 200
#: A text layer where this share of characters is replacement/control junk is unusable.
MAX_JUNK_RATIO = 0.2

#: PDFium is not thread-safe; extraction jobs run in threads, so every PDFium call is serialised.
_PDFIUM_LOCK = threading.Lock()


class DocumentError(Exception):
    code = "document_error"


class NotAPdfError(DocumentError):
    code = "not_a_pdf"


class FileTooLargeError(DocumentError):
    code = "file_too_large"


class TooManyPagesError(DocumentError):
    code = "too_many_pages"


class CorruptPdfError(DocumentError):
    code = "corrupt_pdf"


class EncryptedPdfError(DocumentError):
    code = "encrypted_pdf"


class EmptyPdfError(DocumentError):
    code = "empty_pdf"


class UnsupportedLanguageError(DocumentError):
    code = "unsupported_language"


class ExtractionCancelledError(DocumentError):
    code = "cancelled"


class OcrEngine(Protocol):
    def require_languages(self, languages: Iterable[str]) -> None: ...

    def recognize(self, image: Path, languages: Iterable[str], timeout_s: float) -> OcrResult: ...


@dataclass
class PageExtraction:
    page: int
    #: "text" (native layer) | "ocr" | "none"
    method: str
    #: "ok" | "empty" | "ocr_required" (OCR needed but unavailable) | "failed" | "skipped"
    status: str
    #: Original extracted text of this page (native or OCR), never cleaned.
    text: str = ""
    #: The native text layer, kept even when OCR replaced it.
    native_text: str = ""
    #: Why OCR was used or wanted: "no_text_layer" | "unusable_text_layer" | "sparse_text_with_images"
    #: | "forced" | None
    ocr_reason: str | None = None
    #: OCR recognition confidence 0-100 (not factual correctness).
    confidence: float | None = None
    error: str | None = None
    warnings: list[str] = field(default_factory=list)


@dataclass
class DocumentExtraction:
    source_name: str
    sha256: str
    size_bytes: int
    page_count: int
    languages: list[str]
    pages: list[PageExtraction]
    elapsed_ms: int = 0
    #: Document-level problems (e.g. {"code": "tesseract_missing", "message": ...}).
    errors: list[dict[str, str]] = field(default_factory=list)

    def summary(self) -> dict[str, Any]:
        by = lambda **kv: [p.page for p in self.pages if all(getattr(p, k) == v for k, v in kv.items())]  # noqa: E731
        confidences = [p.confidence for p in self.pages if p.confidence is not None]
        return {
            "pageCount": self.page_count,
            "textPages": by(method="text", status="ok"),
            "ocrPages": by(method="ocr", status="ok"),
            "emptyPages": by(status="empty"),
            "ocrRequiredPages": by(status="ocr_required"),
            "failedPages": by(status="failed"),
            "skippedPages": by(status="skipped"),
            "textChars": sum(len(p.text) for p in self.pages),
            "meanOcrConfidence": round(sum(confidences) / len(confidences), 1) if confidences else None,
        }

    def to_json(self) -> dict[str, Any]:
        return {
            "sourceName": self.source_name,
            "sha256": self.sha256,
            "sizeBytes": self.size_bytes,
            "languages": self.languages,
            "elapsedMs": self.elapsed_ms,
            "errors": self.errors,
            "summary": self.summary(),
            "pages": [{_camel(k): v for k, v in asdict(p).items()} for p in self.pages],
        }


def _camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.title() for part in rest)


def looks_like_pdf(data: bytes) -> bool:
    """PDF header within the first 1 KiB, as readers accept; extension and MIME are never trusted."""
    return b"%PDF-" in data[:1024]


def ocr_reason(text: str, has_images: bool = False) -> str | None:
    """Why a native text layer should be replaced by OCR, or None when it is usable.

    A page with only a little text over images (a browser print whose header/footer are text but
    whose article body is a picture) is OCR'd too, instead of being skipped for its few characters.
    """
    meaningful = sum(ch.isalnum() for ch in text)
    if meaningful < MIN_TEXT_CHARS:
        return "no_text_layer"
    junk = sum(ch == "�" or (ord(ch) < 32 and ch not in "\n\r\t") for ch in text)
    if junk / max(1, len(text)) > MAX_JUNK_RATIO:
        return "unusable_text_layer"
    if has_images and meaningful < SPARSE_TEXT_CHARS:
        return "sparse_text_with_images"
    return None


def _has_images(page: Any) -> bool:
    """Whether the page's resources declare an image XObject (cheap: nothing is decoded)."""
    try:
        xobjects = page.get("/Resources", {}).get("/XObject", {})
        return any(obj.get_object().get("/Subtype") == "/Image" for obj in xobjects.values())
    except Exception:  # noqa: BLE001 - malformed resources: treat as no images
        return False


def validate_languages(languages: Iterable[str]) -> list[str]:
    langs = list(dict.fromkeys(languages))
    unknown = [lang for lang in langs if lang not in SUPPORTED_LANGUAGES]
    if not langs or unknown:
        raise UnsupportedLanguageError(
            f"Unsupported OCR language(s): {', '.join(unknown) or 'none given'}; use {', '.join(SUPPORTED_LANGUAGES)}")
    return langs


def _open(data: bytes):
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
        if reader.is_encrypted:
            try:
                if not reader.decrypt(""):
                    raise EncryptedPdfError("The PDF is password-protected.")
            except EncryptedPdfError:
                raise
            except Exception:  # noqa: BLE001 - unsupported crypto, bad keys: all mean "cannot open"
                raise EncryptedPdfError("The PDF is encrypted and cannot be opened.") from None
        count = len(reader.pages)
    except DocumentError:
        raise
    except (PdfReadError, ValueError, KeyError, TypeError, AttributeError, IndexError, OSError, RecursionError):
        raise CorruptPdfError("The file is not a readable PDF.") from None
    return reader, count


def _render_pgm(pdf: Any, index: int, target: Path) -> None:
    """Render one page to an 8-bit grayscale PGM, which Tesseract reads without extra libraries."""
    with _PDFIUM_LOCK:
        page = pdf[index]
        try:
            width, height = page.get_size()
            scale = OCR_DPI / 72
            pixels = width * height * scale * scale
            if pixels > MAX_RENDER_PIXELS:
                scale *= (MAX_RENDER_PIXELS / pixels) ** 0.5
            bitmap = page.render(scale=scale, grayscale=True)
            try:
                w, h, stride, channels = bitmap.width, bitmap.height, bitmap.stride, bitmap.n_channels
                raw = bytes(bitmap.buffer)
            finally:
                bitmap.close()
        finally:
            page.close()
    if channels != 1:
        raise OcrError("unexpected bitmap format from PDF renderer")
    rows = raw if stride == w else b"".join(raw[y * stride:y * stride + w] for y in range(h))
    target.write_bytes(b"P5\n%d %d\n255\n" % (w, h) + rows)


def extract_pdf(
    data: bytes,
    source_name: str,
    *,
    languages: Iterable[str] = DEFAULT_LANGUAGES,
    ocr: OcrEngine | None = None,
    ocr_unavailable: OcrError | None = None,
    force_ocr_pages: Iterable[int] = (),
    max_bytes: int = MAX_PDF_BYTES,
    max_pages: int = MAX_PAGES,
    deadline_s: float = DOCUMENT_TIMEOUT_S,
    page_timeout_s: float = PAGE_OCR_TIMEOUT_S,
    on_progress: Callable[[int, int, str], None] | None = None,
    should_cancel: Callable[[], bool] | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> DocumentExtraction:
    """Extract every page. Raises DocumentError for whole-file problems; page problems are reported.

    `ocr` is the engine for pages needing OCR; when None, `ocr_unavailable` explains why (for
    example a missing Tesseract) and those pages are reported as "ocr_required".
    """
    started = clock()
    langs = validate_languages(languages)
    if len(data) > max_bytes:
        raise FileTooLargeError(f"The PDF is larger than {max_bytes // (1024 * 1024)} MB.")
    if not data:
        raise EmptyPdfError("The file is empty.")
    if not looks_like_pdf(data):
        raise NotAPdfError("The file is not a PDF.")
    reader, count = _open(data)
    if count == 0:
        raise EmptyPdfError("The PDF has no pages.")
    if count > max_pages:
        raise TooManyPagesError(f"The PDF has {count} pages; the limit is {max_pages}.")

    forced = {int(p) for p in force_ocr_pages}
    result = DocumentExtraction(source_name, hashlib.sha256(data).hexdigest(), len(data), count, langs, [])
    language_error: OcrError | None = None
    languages_checked = False
    pdfium_doc = None
    try:
        with tempfile.TemporaryDirectory(prefix="cc-ocr-") as scratch:
            for index in range(count):
                number = index + 1
                if should_cancel and should_cancel():
                    raise ExtractionCancelledError("Extraction cancelled.")
                remaining = deadline_s - (clock() - started)
                if remaining <= 0:
                    result.pages.append(PageExtraction(number, "none", "skipped", error="document_timeout"))
                    continue
                if on_progress:
                    on_progress(index, count, "extracting")
                page = PageExtraction(number, "text", "ok")
                try:
                    page.native_text = reader.pages[index].extract_text() or ""
                except Exception as error:  # noqa: BLE001 - a broken page must not end the document
                    page.warnings.append(f"text layer unreadable ({type(error).__name__})")
                page.text = page.native_text
                reason = "forced" if number in forced else ocr_reason(page.native_text, _has_images(reader.pages[index]))
                if reason is None:
                    result.pages.append(page)
                    continue
                page.ocr_reason = reason
                if ocr is None:
                    page.method, page.status = "none", "ocr_required"
                    page.error = ocr_unavailable.code if ocr_unavailable else "tesseract_missing"
                    result.pages.append(page)
                    continue
                if not languages_checked:
                    languages_checked = True
                    try:
                        ocr.require_languages(langs)
                    except OcrError as error:
                        language_error = error
                        result.errors.append({"code": error.code, "message": str(error)})
                if language_error is not None:
                    page.method, page.status, page.error = "none", "ocr_required", language_error.code
                    result.pages.append(page)
                    continue
                if on_progress:
                    on_progress(index, count, "ocr_running")
                image = Path(scratch) / f"page-{number:04d}.pgm"
                try:
                    if pdfium_doc is None:
                        import pypdfium2 as pdfium
                        with _PDFIUM_LOCK:
                            pdfium_doc = pdfium.PdfDocument(data)
                    _render_pgm(pdfium_doc, index, image)
                    ocr_result = ocr.recognize(image, langs, min(page_timeout_s, remaining))
                except OcrError as error:
                    page.method, page.status, page.error = "ocr", "failed", error.code
                    page.warnings.append(str(error)[:300])
                    result.pages.append(page)
                    continue
                except Exception as error:  # noqa: BLE001 - renderer failure on one page
                    page.method, page.status, page.error = "ocr", "failed", "render_failed"
                    page.warnings.append(f"page could not be rendered ({type(error).__name__})")
                    result.pages.append(page)
                    continue
                finally:
                    image.unlink(missing_ok=True)
                page.method, page.text, page.confidence = "ocr", ocr_result.text, ocr_result.confidence
                result.pages.append(page)
    finally:
        if pdfium_doc is not None:
            with _PDFIUM_LOCK:
                pdfium_doc.close()

    for page in result.pages:
        if page.status == "ok" and not page.text.strip():
            page.status = "empty"
            page.warnings.append("no text found on this page")
    if any(p.error == "document_timeout" for p in result.pages):
        result.errors.append({"code": "document_timeout",
                              "message": f"Processing stopped after {deadline_s:.0f} s; later pages were skipped."})
    if ocr is None and any(p.status == "ocr_required" for p in result.pages):
        message = str(ocr_unavailable) if ocr_unavailable else "OCR is not available."
        result.errors.append({"code": ocr_unavailable.code if ocr_unavailable else "tesseract_missing", "message": message})
    if on_progress:
        on_progress(count, count, "complete")
    result.elapsed_ms = int((clock() - started) * 1000)
    return result
