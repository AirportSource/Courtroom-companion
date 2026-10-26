"""In-memory PDF extraction jobs (D-100): progress, cancellation, results kept until discarded.

One short-lived worker thread per job; it ends with the job, so no service keeps running. Results
(including the original extracted text) live only in memory; nothing is written to user data in
this phase, and no document text is logged.
"""

from __future__ import annotations

import logging
import secrets
import threading
import time
from collections import OrderedDict
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any

from .pdf import DocumentError, DocumentExtraction, OcrEngine, extract_pdf
from .tesseract import OcrError, TesseractEngine

logger = logging.getLogger(__name__)

MAX_JOBS = 8
MAX_RUNNING = 2

#: Job states, matching the Character Studio vocabulary.
STATES = ("queued", "extracting", "ocr_running", "complete", "ocr_required", "failed", "cancelled")
FINAL = {"complete", "ocr_required", "failed", "cancelled"}


class TooManyJobsError(Exception):
    pass


class JobNotFoundError(KeyError):
    pass


@dataclass
class ExtractionJob:
    id: str
    character_id: str
    source_name: str
    state: str = "queued"
    pages_done: int = 0
    pages_total: int = 0
    created: float = field(default_factory=time.time)
    result: DocumentExtraction | None = None
    error: dict[str, str] | None = None
    cancel: threading.Event = field(default_factory=threading.Event)

    def to_json(self, include_pages: bool = True) -> dict[str, Any]:
        body: dict[str, Any] = {
            "id": self.id,
            "character": self.character_id,
            "sourceName": self.source_name,
            "state": self.state,
            "progress": {"pagesDone": self.pages_done, "pagesTotal": self.pages_total},
            "error": self.error,
        }
        if self.result is not None:
            extraction = self.result.to_json()
            if not include_pages:
                extraction.pop("pages")
            body["extraction"] = extraction
        return body


EngineFactory = Callable[[], OcrEngine]


class ExtractionJobs:
    def __init__(self, engine_factory: EngineFactory = TesseractEngine.discover, **extract_options: Any) -> None:
        self.engine_factory = engine_factory
        self.extract_options = extract_options
        self._jobs: OrderedDict[str, ExtractionJob] = OrderedDict()
        self._lock = threading.Lock()

    def _running(self) -> int:
        return sum(job.state not in FINAL for job in self._jobs.values())

    def start(self, data: bytes, source_name: str, character_id: str, languages: Iterable[str],
              force_ocr_pages: Iterable[int] = (), wait: bool = False) -> ExtractionJob:
        with self._lock:
            if self._running() >= MAX_RUNNING:
                raise TooManyJobsError()
            for old in [j for j in self._jobs.values() if j.state in FINAL][: max(0, len(self._jobs) - MAX_JOBS + 1)]:
                self._jobs.pop(old.id)
            if len(self._jobs) >= MAX_JOBS:
                raise TooManyJobsError()
            job = ExtractionJob(secrets.token_hex(8), character_id, source_name)
            self._jobs[job.id] = job
        worker = threading.Thread(target=self._run, args=(job, data, list(languages), list(force_ocr_pages)),
                                  name=f"pdf-extract-{job.id}", daemon=True)
        worker.start()
        if wait:
            worker.join()
        return job

    def _run(self, job: ExtractionJob, data: bytes, languages: list[str], force: list[int]) -> None:
        engine, unavailable = None, None
        try:
            engine = self.engine_factory()
        except OcrError as error:
            unavailable = error

        def progress(done: int, total: int, stage: str) -> None:
            job.pages_done, job.pages_total = done, total
            if stage in ("extracting", "ocr_running"):
                job.state = stage

        try:
            job.state = "extracting"
            job.result = extract_pdf(data, job.source_name, languages=languages, ocr=engine,
                                     ocr_unavailable=unavailable, force_ocr_pages=force, on_progress=progress,
                                     should_cancel=job.cancel.is_set, **self.extract_options)
            job.state = "ocr_required" if job.result.summary()["ocrRequiredPages"] else "complete"
        except DocumentError as error:
            job.state = "cancelled" if error.code == "cancelled" else "failed"
            job.error = {"code": error.code, "message": str(error)}
        except Exception as error:  # noqa: BLE001 - never let a worker die silently
            logger.exception("pdf extraction job %s failed", job.id)
            job.state = "failed"
            job.error = {"code": "extraction_failed", "message": f"Unexpected error ({type(error).__name__})."}

    def get(self, job_id: str) -> ExtractionJob:
        job = self._jobs.get(job_id)
        if job is None:
            raise JobNotFoundError(job_id)
        return job

    def discard(self, job_id: str) -> None:
        """Cancel if still running, then forget the job and its text."""
        job = self.get(job_id)
        job.cancel.set()
        with self._lock:
            self._jobs.pop(job_id, None)
