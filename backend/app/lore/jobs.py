"""In-memory lore analysis jobs (D-101): one asyncio task per job, cancellable, results kept until
discarded. Proposals are not persisted in this phase (Phase D adds approval and storage)."""

from __future__ import annotations

import asyncio
import logging
import secrets
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any

from ..characters.repository import CharacterProfile
from ..documents.pdf import DocumentExtraction
from ..llm.gateway import LLMGateway
from .schemas import LoreProposal
from .service import AnalysisOptions, analyze_document, proposal_json

logger = logging.getLogger(__name__)

MAX_ANALYSES = 8
MAX_RUNNING = 1
FINAL = {"review_required", "failed", "cancelled"}


class TooManyAnalysesError(Exception):
    pass


class AnalysisNotFoundError(KeyError):
    pass


@dataclass
class AnalysisJob:
    id: str
    character_id: str
    extraction_id: str
    state: str = "analyzing"
    chunks_done: int = 0
    chunks_total: int = 0
    proposal: LoreProposal | None = None
    error: dict[str, str] | None = None
    task: asyncio.Task | None = field(default=None, repr=False)

    def to_json(self) -> dict[str, Any]:
        return {"id": self.id, "character": self.character_id, "extraction": self.extraction_id, "state": self.state,
                "progress": {"chunksDone": self.chunks_done, "chunksTotal": self.chunks_total}, "error": self.error,
                "proposal": proposal_json(self.proposal) if self.proposal else None}


class AnalysisJobs:
    def __init__(self) -> None:
        self._jobs: OrderedDict[str, AnalysisJob] = OrderedDict()

    def start(self, extraction: DocumentExtraction, extraction_id: str, profile: CharacterProfile,
              gateway: LLMGateway, options: AnalysisOptions) -> AnalysisJob:
        if sum(j.state not in FINAL for j in self._jobs.values()) >= MAX_RUNNING:
            raise TooManyAnalysesError()
        for old in [j for j in self._jobs.values() if j.state in FINAL][: max(0, len(self._jobs) - MAX_ANALYSES + 1)]:
            self._jobs.pop(old.id)
        job = AnalysisJob(secrets.token_hex(8), profile.id, extraction_id)
        self._jobs[job.id] = job

        def progress(done: int, total: int) -> None:
            job.chunks_done, job.chunks_total = done, total

        async def run() -> None:
            try:
                job.proposal = await analyze_document(extraction, profile, gateway, options, progress)
                job.state = "review_required"
            except asyncio.CancelledError:
                job.state = "cancelled"
                raise
            except Exception as error:  # noqa: BLE001 - a failed analysis is reported, never crashes the app
                logger.exception("lore analysis %s failed", job.id)
                job.state = "failed"
                job.error = {"code": "analysis_failed", "message": f"Unexpected error ({type(error).__name__})."}

        job.task = asyncio.create_task(run(), name=f"lore-analysis-{job.id}")
        return job

    def get(self, job_id: str) -> AnalysisJob:
        job = self._jobs.get(job_id)
        if job is None:
            raise AnalysisNotFoundError(job_id)
        return job

    def discard(self, job_id: str) -> None:
        job = self.get(job_id)
        if job.task is not None and not job.task.done():
            job.task.cancel()
        self._jobs.pop(job_id, None)
