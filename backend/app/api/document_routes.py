"""Reference-document import API (Character Lore Builder, D-100). Local, same-origin only.

The raw request body is the PDF; its original name is the percent-encoded X-Filename header. The
name is only displayed: nothing is written to disk from it. Extraction runs as a job polled by id.

Lore analysis (D-101) runs on a finished extraction with the active provider profile. OCR is always
local; analysis with a remote provider sends the cleaned text off this machine, so it requires
`allowRemote: true` in the request (the UI must ask the user). Analysis only produces a proposal.

Wire in main.py:
    app.state.document_extractions = ExtractionJobs()
    app.include_router(document_router)
"""

from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from ..characters.repository import CharacterNotFoundError
from ..documents.jobs import ExtractionJobs, JobNotFoundError, TooManyJobsError
from ..documents.pdf import MAX_PDF_BYTES, UnsupportedLanguageError, looks_like_pdf, validate_languages
from ..documents.tesseract import DEFAULT_LANGUAGES, INSTALL_HINT, SUPPORTED_LANGUAGES, OcrError, TesseractEngine
from ..configuration.profiles import ProfileNotFoundError
from ..llm.gateway import LLMGateway
from ..lore.cleaning import clean_pages
from ..lore.jobs import AnalysisJobs, AnalysisNotFoundError, TooManyAnalysesError
from ..lore.service import AnalysisOptions, provider_is_remote
from .profile_routes import local_configuration_request


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


router = APIRouter(prefix="/api/documents", dependencies=[Depends(local_configuration_request), Depends(_no_store)])


def jobs(request: Request) -> ExtractionJobs:
    return request.app.state.document_extractions


def _display_name(header: str | None) -> str:
    """Last path component of the declared name, printable, at most 120 characters."""
    name = unquote(header or "document.pdf").replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(ch for ch in name if ch.isprintable()).strip() or "document.pdf"
    return name[:120]


def _ocr_status() -> dict:
    try:
        engine = TesseractEngine.discover()
        installed = [lang for lang in engine.languages() if lang != "osd"]
        return {
            "available": True,
            "version": engine.version(),
            "source": engine.discovery.source,
            "languages": installed,
            "supported": SUPPORTED_LANGUAGES,
            "missingDefaultLanguages": [lang for lang in DEFAULT_LANGUAGES if lang not in installed],
        }
    except OcrError as error:
        return {"available": False, "error": {"code": error.code, "message": str(error)},
                "supported": SUPPORTED_LANGUAGES, "installHint": INSTALL_HINT}


@router.get("/ocr")
async def ocr_status() -> dict:
    """Whether local OCR works here, which languages are installed. Never exposes file paths."""
    return await run_in_threadpool(_ocr_status)


@router.post("/extractions", status_code=202)
async def start_extraction(
    request: Request,
    character: str = Query(min_length=1, max_length=64),
    languages: str = Query("+".join(DEFAULT_LANGUAGES), max_length=40),
    force_ocr: str = Query("", alias="forceOcr", max_length=400),
) -> dict:
    try:
        request.app.state.character_service.repository.get(character)
    except CharacterNotFoundError:
        raise HTTPException(404, "Unknown character.") from None
    try:
        langs = validate_languages(languages.split("+"))
    except UnsupportedLanguageError as error:
        raise HTTPException(422, str(error)) from None
    try:
        forced = sorted({int(p) for p in force_ocr.split(",") if p.strip()})
    except ValueError:
        raise HTTPException(422, "forceOcr must be a comma-separated list of page numbers.") from None
    name = _display_name(request.headers.get("x-filename"))
    if not name.lower().endswith(".pdf"):
        raise HTTPException(415, "Only PDF documents are supported.")
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_PDF_BYTES:
        raise HTTPException(413, "The PDF is too large.")
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_PDF_BYTES:
            raise HTTPException(413, "The PDF is too large.")
    if not looks_like_pdf(bytes(body)):
        raise HTTPException(415, "The file is not a PDF.")
    try:
        job = jobs(request).start(bytes(body), name, character, langs, forced)
    except TooManyJobsError:
        raise HTTPException(409, "Too many document extractions; wait for one to finish or discard one.") from None
    return job.to_json(include_pages=False)


@router.get("/extractions/{job_id}")
def get_extraction(job_id: str, request: Request, pages: bool = True) -> dict:
    try:
        return jobs(request).get(job_id).to_json(include_pages=pages)
    except JobNotFoundError:
        raise HTTPException(404, "Unknown extraction.") from None


@router.delete("/extractions/{job_id}", status_code=204)
def discard_extraction(job_id: str, request: Request) -> Response:
    """Cancel a running extraction or forget a finished one (its text is dropped from memory)."""
    try:
        jobs(request).discard(job_id)
    except JobNotFoundError:
        raise HTTPException(404, "Unknown extraction.") from None
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


# ---- lore analysis (D-101) ----------------------------------------------------------------------


def analyses(request: Request) -> AnalysisJobs:
    return request.app.state.lore_analyses


class AnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    #: The user agreed that document text may be sent to a remote provider.
    allow_remote: bool = Field(default=False, alias="allowRemote")
    exclude_pages: list[int] = Field(default_factory=list, alias="excludePages", max_length=80)


def _finished_extraction(request: Request, job_id: str):
    try:
        job = jobs(request).get(job_id)
    except JobNotFoundError:
        raise HTTPException(404, "Unknown extraction.") from None
    if job.result is None:
        raise HTTPException(409, {"code": "extraction_not_ready", "message": "The extraction has not finished."})
    return job


async def analysis_gateway(request: Request) -> LLMGateway:
    """The active provider profile, built like a chat turn's gateway."""
    profiles = request.app.state.provider_profiles
    service = request.app.state.character_service
    try:
        config = await run_in_threadpool(profiles.resolve, profiles.store.get())
    except ProfileNotFoundError:
        raise HTTPException(409, {"code": "no_provider", "message": "Select a saved provider profile first."}) from None
    return LLMGateway(config, registry=service.gateway.registry)


@router.get("/extractions/{job_id}/cleaned")
def cleaned_extraction(job_id: str, request: Request) -> dict:
    """Cleaned page text plus every removed line and its rule (the original stays in the extraction)."""
    job = _finished_extraction(request, job_id)
    return clean_pages({p.page: p.text for p in job.result.pages if p.text.strip()}).to_json()


@router.post("/extractions/{job_id}/analysis", status_code=202)
async def start_analysis(job_id: str, body: AnalysisRequest, request: Request) -> dict:
    job = _finished_extraction(request, job_id)
    if not any(p.text.strip() for p in job.result.pages):
        raise HTTPException(409, {"code": "no_text", "message": "The document has no extracted text to analyse."})
    try:
        profile = request.app.state.character_service.repository.get(job.character_id)
    except CharacterNotFoundError:
        raise HTTPException(404, "Unknown character.") from None
    gateway = await analysis_gateway(request)
    if provider_is_remote(gateway.config) and not body.allow_remote:
        raise HTTPException(409, {"code": "remote_consent_required",
                                  "message": "This provider is remote: the document text would be sent to it. "
                                             "Ask the user, then retry with allowRemote, or use a local provider.",
                                  "provider": gateway.config.public_info()})
    try:
        analysis = analyses(request).start(job.result, job.id, profile, gateway,
                                           AnalysisOptions(exclude_pages=tuple(body.exclude_pages)))
    except TooManyAnalysesError:
        raise HTTPException(409, "An analysis is already running; wait for it or discard it.") from None
    return analysis.to_json()


@router.get("/analyses/{analysis_id}")
def get_analysis(analysis_id: str, request: Request) -> dict:
    try:
        return analyses(request).get(analysis_id).to_json()
    except AnalysisNotFoundError:
        raise HTTPException(404, "Unknown analysis.") from None


@router.delete("/analyses/{analysis_id}", status_code=204)
def discard_analysis(analysis_id: str, request: Request) -> Response:
    try:
        analyses(request).discard(analysis_id)
    except AnalysisNotFoundError:
        raise HTTPException(404, "Unknown analysis.") from None
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
