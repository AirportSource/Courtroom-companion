"""PDF import and local OCR (D-100). Deterministic: a fake OCR engine/runner stands in for Tesseract.

Real-Tesseract integration tests are at the end and skip when no executable is discovered.
"""

import io
import itertools
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.documents import tesseract as tess
from app.documents.jobs import ExtractionJobs
from app.documents.pdf import (
    CorruptPdfError,
    EmptyPdfError,
    FileTooLargeError,
    NotAPdfError,
    TooManyPagesError,
    UnsupportedLanguageError,
    ExtractionCancelledError,
    extract_pdf,
    ocr_reason,
)
from app.documents.tesseract import (
    Discovery,
    LanguageDataMissingError,
    OcrFailedError,
    OcrResult,
    OcrTimeoutError,
    RunResult,
    TesseractEngine,
    TesseractNotFoundError,
    parse_tsv,
)
from app.llm.config import ProviderConfig
from app.main import create_app

from .pdf_fixtures import build_pdf, stripes, text_image

FRENCH = "Évidence : l'été à Hazakura — œuvre ça, « Iris » et sa sœur jumelle."
PARAGRAPH = "Iris was raised at Hazakura Temple by Sister Bikini, far from her twin sister."
BOILER_HEADER = "Iris | Ace Attorney Wiki | Fandom   SIGN IN   CREATE FREE ACCOUNT"


def footer(n, total):
    return f"https://aceattorney.fandom.com/wiki/Iris {n}/{total}"


class FakeOcr:
    """Records the pages it sees and returns canned text; can fail on chosen pages."""

    def __init__(self, text="Recognised text from a scanned page of the Iris article.", languages=("eng", "fra"),
                 fail=None):
        self.text = text
        self.installed = list(languages)
        self.fail = fail or {}
        self.calls: list[dict] = []

    def require_languages(self, languages):
        missing = [lang for lang in languages if lang not in self.installed]
        if missing:
            raise LanguageDataMissingError(missing, self.installed)

    def recognize(self, image: Path, languages, timeout_s):
        header = image.read_bytes()[:2]
        self.calls.append({"name": image.name, "header": header, "languages": list(languages), "timeout": timeout_s,
                           "exists": image.exists(), "dir": image.parent})
        page = int(image.stem.split("-")[1])
        if page in self.fail:
            raise self.fail[page]
        return OcrResult(self.text, 87.5, len(self.text.split()))


# ---- whole-file validation ----------------------------------------------------------------------


def test_text_pdf_is_extracted_without_any_ocr():
    ocr = FakeOcr()
    result = extract_pdf(build_pdf([{"text": [PARAGRAPH, FRENCH]}, {"text": [PARAGRAPH]}]), "Iris.pdf", ocr=ocr)
    assert ocr.calls == []
    assert [(p.page, p.method, p.status) for p in result.pages] == [(1, "text", "ok"), (2, "text", "ok")]
    assert FRENCH in result.pages[0].text  # accents, ligatures, guillemets, em dash preserved
    assert result.summary()["textPages"] == [1, 2] and result.summary()["ocrPages"] == []


def test_image_only_pdf_is_rendered_and_ocrd_page_by_page_with_cleanup():
    ocr = FakeOcr()
    result = extract_pdf(build_pdf([{"image": stripes()}, {"image": stripes()}]), "scan.pdf", ocr=ocr)
    assert [c["name"] for c in ocr.calls] == ["page-0001.pgm", "page-0002.pgm"]
    assert all(c["header"] == b"P5" and c["languages"] == ["eng", "fra"] for c in ocr.calls)
    assert not ocr.calls[0]["dir"].exists()  # temporary page images are removed
    assert [(p.method, p.status, p.ocr_reason, p.confidence) for p in result.pages] == [("ocr", "ok", "no_text_layer", 87.5)] * 2
    assert result.summary()["meanOcrConfidence"] == 87.5


def test_mixed_pdf_only_ocrs_pages_without_text():
    ocr = FakeOcr()
    data = build_pdf([{"text": [PARAGRAPH]}, {"image": stripes()}, {"text": [FRENCH]}])
    result = extract_pdf(data, "mixed.pdf", ocr=ocr)
    assert [c["name"] for c in ocr.calls] == ["page-0002.pgm"]
    assert [p.method for p in result.pages] == ["text", "ocr", "text"]
    assert result.pages[1].text == ocr.text and PARAGRAPH in result.pages[0].text


def test_forced_reocr_keeps_the_native_text():
    ocr = FakeOcr()
    result = extract_pdf(build_pdf([{"text": [PARAGRAPH]}]), "x.pdf", ocr=ocr, force_ocr_pages=[1])
    page = result.pages[0]
    assert (page.method, page.ocr_reason, page.text) == ("ocr", "forced", ocr.text)
    assert PARAGRAPH in page.native_text


def test_repeated_boilerplate_is_kept_verbatim_with_page_numbers():
    pages = [{"text": [BOILER_HEADER, PARAGRAPH, footer(n, 3)]} for n in (1, 2, 3)]
    result = extract_pdf(build_pdf(pages), "Iris.pdf")
    for page in result.pages:
        assert BOILER_HEADER in page.text and footer(page.page, 3) in page.text  # cleaning is a later stage


@pytest.mark.parametrize("data, error", [
    (b"", EmptyPdfError),
    (build_pdf([]), EmptyPdfError),
    (b"%PDF-1.7\nthis is not really a pdf at all", CorruptPdfError),
    (b"PK\x03\x04 a zip renamed to .pdf", NotAPdfError),
    (b"<html>%PDF-</html>"[:5] + b" nope", NotAPdfError),
])
def test_invalid_files_are_rejected_with_explicit_codes(data, error):
    with pytest.raises(error):
        extract_pdf(data, "bad.pdf")


def test_size_page_and_language_limits():
    data = build_pdf([{"text": [PARAGRAPH]}] * 3)
    with pytest.raises(FileTooLargeError):
        extract_pdf(data, "x.pdf", max_bytes=100)
    with pytest.raises(TooManyPagesError):
        extract_pdf(data, "x.pdf", max_pages=2)
    with pytest.raises(UnsupportedLanguageError):
        extract_pdf(data, "x.pdf", languages=["deu"])
    with pytest.raises(UnsupportedLanguageError):
        extract_pdf(data, "x.pdf", languages=["eng; rm -rf /"])


def test_document_deadline_reports_skipped_pages_instead_of_hiding_them():
    ticks = itertools.count(0, 4)  # each clock read advances 4 s
    result = extract_pdf(build_pdf([{"text": [PARAGRAPH]}] * 4), "x.pdf", deadline_s=10, clock=lambda: next(ticks))
    statuses = [p.status for p in result.pages]
    assert "ok" in statuses and statuses[-1] == "skipped"
    assert {e["code"] for e in result.errors} == {"document_timeout"}
    assert result.summary()["skippedPages"]


def test_cancellation_stops_between_pages():
    calls = iter([False, True])
    with pytest.raises(ExtractionCancelledError):
        extract_pdf(build_pdf([{"text": [PARAGRAPH]}] * 3), "x.pdf", should_cancel=lambda: next(calls, True))


def test_unusable_text_layers_are_detected():
    assert ocr_reason("") == "no_text_layer"
    assert ocr_reason("12 / 8") == "no_text_layer"
    assert ocr_reason("\ufffd" * 40 + "abcdefghijklmnopqrstuvwxyz0123") == "unusable_text_layer"
    assert ocr_reason(PARAGRAPH) is None
    # A browser print: header/footer as text, body as an image -> still OCR'd.
    header = "26/10/2026 14:09 Iris | Ace Attorney Wiki | Fandom https://aceattorney.fandom.com/wiki/Iris 1/8"
    assert ocr_reason(header) is None
    assert ocr_reason(header, has_images=True) == "sparse_text_with_images"
    assert ocr_reason(PARAGRAPH * 4, has_images=True) is None  # real text beside a picture stays native


def test_page_with_a_text_header_over_an_image_body_is_ocrd():
    header = "26/10/2026 14:09 Iris | Ace Attorney Wiki | Fandom https://aceattorney.fandom.com/wiki/Iris 1/8"
    ocr = FakeOcr()
    result = extract_pdf(build_pdf([{"image": stripes(), "text": [header]}, {"text": [PARAGRAPH] * 4}]), "x.pdf", ocr=ocr)
    assert [c["name"] for c in ocr.calls] == ["page-0001.pgm"]
    assert (result.pages[0].ocr_reason, result.pages[0].method) == ("sparse_text_with_images", "ocr")
    assert header in result.pages[0].native_text  # the native layer is kept beside the OCR text


# ---- OCR unavailable / failing ------------------------------------------------------------------


def test_missing_tesseract_marks_pages_ocr_required_and_keeps_text_pages():
    error = TesseractNotFoundError("Tesseract OCR was not found.")
    data = build_pdf([{"text": [PARAGRAPH]}, {"image": stripes()}])
    result = extract_pdf(data, "x.pdf", ocr=None, ocr_unavailable=error)
    assert [(p.status, p.error) for p in result.pages] == [("ok", None), ("ocr_required", "tesseract_missing")]
    assert result.errors == [{"code": "tesseract_missing", "message": "Tesseract OCR was not found."}]


def test_missing_language_data_is_explicit():
    ocr = FakeOcr(languages=("eng",))
    result = extract_pdf(build_pdf([{"image": stripes()}]), "x.pdf", ocr=ocr, languages=["eng", "jpn"])
    assert ocr.calls == []
    assert (result.pages[0].status, result.pages[0].error) == ("ocr_required", "language_data_missing")
    assert "jpn" in result.errors[0]["message"] and "traineddata" in result.errors[0]["message"]


def test_ocr_failure_and_timeout_stay_in_the_page_report():
    ocr = FakeOcr(fail={1: OcrTimeoutError("Tesseract did not finish within 90 s"), 2: OcrFailedError("boom")})
    result = extract_pdf(build_pdf([{"image": stripes()}] * 3), "x.pdf", ocr=ocr)
    assert [(p.status, p.error) for p in result.pages] == [("failed", "ocr_timeout"), ("failed", "ocr_failed"), ("ok", None)]
    assert result.summary()["failedPages"] == [1, 2]


def test_blank_ocr_result_is_reported_as_empty():
    result = extract_pdf(build_pdf([{}]), "blank.pdf", ocr=FakeOcr(text="  "))
    assert result.pages[0].status == "empty" and result.summary()["emptyPages"] == [1]


# ---- Tesseract CLI wrapper (fake runner) --------------------------------------------------------

TSV = ("level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
       "1\t1\t0\t0\t0\t0\t0\t0\t100\t100\t-1\t\n"
       "5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t96.0\tSœur\n"
       "5\t1\t1\t1\t1\t2\t0\t0\t10\t10\t90.0\tjumelle\n"
       "5\t1\t1\t1\t2\t1\t0\t0\t10\t10\t80.0\tDahlia\n"
       "5\t1\t2\t1\t1\t1\t0\t0\t10\t10\t70.0\tあやめ\n"
       "5\t1\t2\t1\t1\t2\t0\t0\t10\t10\t-1\t \n")


def _word(block, par, line, left, text, top=100, height=30):
    return "\t".join(map(str, (5, 1, block, par, line, 1, left, top, len(text) * 15, height, 95, text)))


def test_a_sidebar_column_merged_into_body_lines_is_split_out():
    """Iris.pdf page 2: Tesseract put the infobox ("Reckoned ...") on the body's lines."""
    rows = [_word(1, 1, 1, 100, "of"), _word(1, 1, 1, 145, "the"), _word(1, 1, 1, 205, "Fey"), _word(1, 1, 1, 260, "clan,"),
            _word(1, 1, 1, 900, "Reckoned"), _word(1, 1, 1, 1035, "1993"),
            _word(1, 1, 2, 100, "jeweler.", top=140), _word(1, 1, 2, 905, "year(s)?", top=140)]
    text = parse_tsv("\n".join(rows)).text
    assert text == "of the Fey clan,\njeweler.\n\nReckoned 1993\nyear(s)?"


def test_tsv_is_rebuilt_into_lines_and_paragraphs_with_confidence():
    result = parse_tsv(TSV)
    assert result.text == "Sœur jumelle\nDahlia\n\nあやめ"
    assert result.confidence == 84.0 and result.word_count == 4


class FakeRunner:
    def __init__(self, langs=("eng", "fra", "osd"), recognise=None):
        self.langs = langs
        self.recognise = recognise or (lambda: RunResult(0, TSV.encode("utf-8"), b""))
        self.calls = []

    def __call__(self, argv, timeout, env):
        self.calls.append((argv, timeout, env))
        if argv[1] == "--list-langs":
            return RunResult(0, ('List of available languages in "C:\\tessdata\\" (3):\n'
                                 + "\n".join(self.langs) + "\n").encode(), b"")
        if argv[1] == "--version":
            return RunResult(0, b"tesseract v5.5.0.20241111\n leptonica-1.85.0\n", b"")
        return self.recognise()


def engine(runner, tessdata=None):
    return TesseractEngine(Discovery(Path("C:/ocr/tesseract.exe"), "bundled", tessdata), runner)


def test_engine_queries_version_languages_and_runs_tsv(tmp_path, monkeypatch):
    monkeypatch.delenv("TESSDATA_PREFIX", raising=False)
    runner = FakeRunner()
    ocr = engine(runner, tessdata=tmp_path)
    assert ocr.version() == "5.5.0.20241111"
    assert ocr.languages() == ["eng", "fra", "osd"]
    result = ocr.recognize(tmp_path / "page-0001.pgm", ["eng", "fra"], 30)
    argv, timeout, env = runner.calls[-1]
    assert argv[2:] == ["stdout", "-l", "eng+fra", "tsv"] and timeout == 30
    assert env == {"TESSDATA_PREFIX": str(tmp_path)}  # bundled tessdata is used
    assert result.text.startswith("Sœur jumelle")


def test_engine_reports_missing_japanese_and_failures():
    with pytest.raises(LanguageDataMissingError) as missing:
        engine(FakeRunner()).recognize(Path("p.pgm"), ["eng", "jpn"], 5)
    assert missing.value.missing == ["jpn"] and "osd" not in missing.value.available
    failing = FakeRunner(recognise=lambda: RunResult(1, b"", b"Error: image file not readable\n"))
    with pytest.raises(OcrFailedError, match="not readable"):
        engine(failing).recognize(Path("p.pgm"), ["eng"], 5)

    def timeout():
        raise OcrTimeoutError("Tesseract did not finish within 5 s")
    with pytest.raises(OcrTimeoutError):
        engine(FakeRunner(recognise=timeout)).recognize(Path("p.pgm"), ["eng"], 5)


def test_discovery_order_and_explicit_misconfiguration(tmp_path, monkeypatch):
    monkeypatch.setattr(tess.runtime_paths, "resource_root", lambda: tmp_path / "bundle")
    monkeypatch.setattr(tess, "_standard_installs", lambda: [tmp_path / "pf" / "tesseract.exe"])
    monkeypatch.delenv(tess.TESSERACT_ENV, raising=False)
    with pytest.raises(TesseractNotFoundError, match="not found"):
        tess.discover(which=lambda _: None)
    standard = tmp_path / "pf" / "tesseract.exe"
    standard.parent.mkdir()
    standard.write_bytes(b"")
    assert tess.discover(which=lambda _: None).source == "standard_install"
    assert tess.discover(which=lambda _: str(tmp_path / "on-path.exe")).source == "path"
    bundled = tmp_path / "bundle" / "tesseract" / tess._exe_name()
    (bundled.parent / "tessdata").mkdir(parents=True)
    bundled.write_bytes(b"")
    found = tess.discover(which=lambda _: None)
    assert (found.source, found.tessdata) == ("bundled", bundled.parent / "tessdata")
    explicit = tmp_path / "custom.exe"
    explicit.write_bytes(b"")
    monkeypatch.setenv(tess.TESSERACT_ENV, str(explicit))
    assert tess.discover().source == "env"
    monkeypatch.setenv(tess.TESSERACT_ENV, str(tmp_path / "missing.exe"))
    with pytest.raises(TesseractNotFoundError, match=tess.TESSERACT_ENV):
        tess.discover()  # an explicit path that points nowhere is an error, never a silent fallback


def test_repository_tesseract_source_folder_is_not_mistaken_for_a_binary(monkeypatch):
    """The owner's repo-root `tesseract/` holds 5.5.3 sources only; discovery must not pick it up."""
    monkeypatch.delenv(tess.TESSERACT_ENV, raising=False)
    root = tess.runtime_paths.resource_root() / "tesseract"
    if (root / tess._exe_name()).is_file():
        pytest.skip("a Tesseract binary has been placed in the repository folder")
    monkeypatch.setattr(tess, "_standard_installs", lambda: [])
    with pytest.raises(TesseractNotFoundError):
        tess.discover(which=lambda _: None)


# ---- jobs and API -------------------------------------------------------------------------------


def test_jobs_report_states_progress_and_discard():
    jobs = ExtractionJobs(engine_factory=lambda: (_ for _ in ()).throw(TesseractNotFoundError("missing")))
    job = jobs.start(build_pdf([{"text": [PARAGRAPH]}, {"image": stripes()}]), "Iris.pdf", "iris", ["eng"], wait=True)
    assert job.state == "ocr_required" and job.pages_done == job.pages_total == 2
    body = job.to_json()
    assert body["extraction"]["summary"]["ocrRequiredPages"] == [2]
    assert body["extraction"]["pages"][0]["page"] == 1
    assert "pages" not in job.to_json(include_pages=False)["extraction"]
    ok = ExtractionJobs(engine_factory=FakeOcr).start(build_pdf([{"image": stripes()}]), "s.pdf", "iris", ["eng"], wait=True)
    assert ok.state == "complete"
    bad = ExtractionJobs(engine_factory=FakeOcr).start(b"%PDF-1.4 junk", "s.pdf", "iris", ["eng"], wait=True)
    assert bad.state == "failed" and bad.error["code"] == "corrupt_pdf"
    jobs.discard(job.id)
    with pytest.raises(KeyError):
        jobs.get(job.id)


@pytest.fixture
def client():
    app = create_app(ProviderConfig(type="fake"), document_extractions=ExtractionJobs(engine_factory=FakeOcr))
    with TestClient(app, base_url="http://localhost", client=("127.0.0.1", 50000)) as test_client:
        yield test_client


def _upload(client, data, name="Iris.pdf", **params):
    return client.post("/api/documents/extractions", params={"character": "iris", **params}, content=data,
                       headers={"X-Filename": name})


def _wait(client, job_id):
    for _ in range(200):
        body = client.get(f"/api/documents/extractions/{job_id}").json()
        if body["state"] in {"complete", "ocr_required", "failed", "cancelled"}:
            return body
        import time
        time.sleep(0.02)
    raise AssertionError("job did not finish")


def test_api_extracts_a_mixed_pdf_and_reports_provenance(client):
    data = build_pdf([{"text": [PARAGRAPH]}, {"image": stripes()}])
    started = _upload(client, data, name="..%2F..%2Fevil%5CIris.pdf", languages="eng+fra")
    assert started.status_code == 202 and started.headers["cache-control"] == "no-store"
    body = _wait(client, started.json()["id"])
    assert body["state"] == "complete" and body["sourceName"] == "Iris.pdf"  # path parts stripped
    assert [(p["page"], p["method"]) for p in body["extraction"]["pages"]] == [(1, "text"), (2, "ocr")]
    assert client.delete(f"/api/documents/extractions/{body['id']}").status_code == 204
    assert client.get(f"/api/documents/extractions/{body['id']}").status_code == 404


def test_api_rejects_bad_requests(client):
    data = build_pdf([{"text": [PARAGRAPH]}])
    assert _upload(client, data, name="notes.txt").status_code == 415
    assert _upload(client, b"MZ\x90\x00 an exe", name="Iris.pdf").status_code == 415
    assert client.post("/api/documents/extractions", params={"character": "nobody"}, content=data,
                       headers={"X-Filename": "a.pdf"}).status_code == 404
    assert _upload(client, data, languages="deu").status_code == 422
    assert _upload(client, data, forceOcr="1,two").status_code == 422


def test_api_is_local_only(client):
    data = build_pdf([{"text": [PARAGRAPH]}])
    response = client.post("/api/documents/extractions", params={"character": "iris"}, content=data,
                           headers={"X-Filename": "a.pdf", "Origin": "https://evil.example"})
    assert response.status_code == 403


def test_api_ocr_status_never_leaks_paths(client, monkeypatch):
    monkeypatch.setattr("app.api.document_routes.TesseractEngine.discover",
                        lambda: engine(FakeRunner(langs=("eng", "osd"))))
    body = client.get("/api/documents/ocr").json()
    assert body["available"] and body["languages"] == ["eng"] and body["missingDefaultLanguages"] == ["fra"]
    assert "C:/ocr" not in json.dumps(body) and "tesseract.exe" not in json.dumps(body)

    def missing():
        raise TesseractNotFoundError("Tesseract OCR was not found.")
    monkeypatch.setattr("app.api.document_routes.TesseractEngine.discover", missing)
    body = client.get("/api/documents/ocr").json()
    assert not body["available"] and body["error"]["code"] == "tesseract_missing" and body["installHint"]


# ---- real Tesseract (skipped when not installed) ------------------------------------------------


def _real_engine():
    try:
        found = TesseractEngine.discover()
        found.languages()
        return found
    except tess.OcrError:
        return None


REAL = _real_engine()
needs_tesseract = pytest.mark.skipif(REAL is None, reason="Tesseract OCR is not installed or cannot run here")


@needs_tesseract
@pytest.mark.parametrize("lang, line", [("eng", "Iris raised at Hazakura Temple"),
                                        ("fra", "Sœur jumelle élevée à Hazakura")])
def test_real_tesseract_reads_a_scanned_page(lang, line):
    pytest.importorskip("PIL")
    if lang not in REAL.languages():
        pytest.skip(f"{lang}.traineddata not installed")
    result = extract_pdf(build_pdf([{"image": text_image([line])}]), "scan.pdf", ocr=REAL, languages=[lang])
    page = result.pages[0]
    assert page.method == "ocr" and page.status == "ok" and page.confidence is not None
    assert "Hazakura" in page.text


@needs_tesseract
def test_real_tesseract_japanese_when_installed():
    pytest.importorskip("PIL")
    if "jpn" not in REAL.languages():
        pytest.skip("jpn.traineddata not installed")
    font = Path(__file__).resolve().parents[2] / "frontend" / "public" / "assets" / "ui" / "fonts" / "DotGothic16-Regular.ttf"
    if not font.is_file():
        pytest.skip("no Japanese font available to render the fixture")
    image = text_image(["あやめ", "法廷"], size=96, font_path=font)
    result = extract_pdf(build_pdf([{"image": image}]), "scan.pdf", ocr=REAL, languages=["jpn"])
    page = result.pages[0]
    assert page.status == "ok" and page.error is None
    assert "法廷" in page.text.replace(" ", "")


IRIS_PDF = Path(__file__).resolve().parents[2] / "docs" / "personnality_documents" / "Iris.pdf"


@needs_tesseract
@pytest.mark.skipif(not IRIS_PDF.is_file(), reason="the owner's Iris.pdf is not available locally")
def test_real_iris_pdf_is_ocrd_with_page_provenance():
    result = extract_pdf(IRIS_PDF.read_bytes(), "Iris.pdf", ocr=REAL, languages=["eng"])
    summary = result.summary()
    assert summary["pageCount"] == 8 and summary["ocrPages"] == list(range(1, 9)) and not summary["failedPages"]
    pages = {p.page: p.text for p in result.pages}
    expected = {1: ["Dahlia Hawthorne", "Phoenix Wright", "Hazakura"], 2: ["Morgan Fey", "Sister Bikini"],
                3: ["eight months", "Mia Fey"], 4: ["Miles Edgeworth", "not guilty"], 5: ["Doug Swallow", "Larry Butz"]}
    for page, names in expected.items():
        for name in names:
            assert name in pages[page], (page, name)
    # The infobox no longer splits the body sentence it was merged into.
    assert "Morgan Fey, and a wealthy\njeweler" in pages[2]
    assert summary["meanOcrConfidence"] > 80
