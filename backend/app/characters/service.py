"""Character Service: orchestrates one conversational turn.

user message -> character context (prompt + schema) -> LLM gateway (any provider)
-> validated CharacterReply -> Character Director -> PerformanceTimeline.

Conversation context is a small in-memory history per (session, character). Future
long-term memory / retrieval would plug in here, when building the message list.
"""

import time
from collections.abc import Awaitable, Callable
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from ..director.director import CharacterDirector, DirectorState
from ..llm.gateway import LLMGateway
from ..llm.schemas import ChatMessage, CharacterReply
from .context import fit_history
from .prompt import build_system_prompt, reply_schema
from .repository import CharacterRepository
from ..artifacts.contracts import turn_prompt, turn_schema
from ..artifacts.store import ArtifactError, ArtifactStore
from ..artifacts.workload import expected_workload
from ..llm.base import OutputWorkload

HISTORY_TURNS = 12  # messages kept per session (user + assistant)


@dataclass
class _Session:
    history: deque[ChatMessage] = field(default_factory=lambda: deque(maxlen=HISTORY_TURNS))
    director_state: DirectorState = field(default_factory=DirectorState)


@dataclass
class ChatResult:
    #: The validated semantic reply (None if the provider failed and the error line was used).
    reply: CharacterReply | None
    performance: dict[str, Any]
    provider: dict[str, Any]
    warnings: list[str]
    artifacts: list[dict] = field(default_factory=list)
    error: str | None = None
    generation: dict[str, Any] = field(default_factory=dict)


class CharacterService:
    def __init__(
        self,
        repository: CharacterRepository,
        gateway: LLMGateway,
        director: CharacterDirector | None = None,
        clock_ms=lambda: time.monotonic() * 1000,
    ) -> None:
        self.repository = repository
        self.gateway = gateway
        self.director = director or CharacterDirector()
        self.clock_ms = clock_ms
        self._sessions: dict[tuple[str, str], _Session] = {}

    async def chat(
        self,
        character_id: str,
        message: str,
        session_id: str = "default",
        gateway: LLMGateway | None = None,
        artifact_store: ArtifactStore | None = None,
        operation_key: str | None = None,
        fingerprint: str | None = None,
        on_artifact_working: Callable[[], Awaitable[None]] | None = None,
        on_expected_workload: Callable[[OutputWorkload], None] | None = None,
    ) -> ChatResult:
        profile = self.repository.get(character_id)  # raises CharacterNotFoundError
        session = self._sessions.setdefault((session_id, character_id), _Session())
        messages = [*fit_history(list(session.history)), ChatMessage(role="user", content=message)]

        active_gateway = gateway or self.gateway
        schema = reply_schema(profile)
        prompt = build_system_prompt(profile)
        if artifact_store is not None:
            schema = turn_schema(schema)
            prompt = turn_prompt(prompt, schema)
        workload = expected_workload(message, artifacts_enabled=artifact_store is not None)
        if on_expected_workload:
            on_expected_workload(workload)
        result = await active_gateway.generate_reply(prompt, messages, schema, workload=workload)
        artifacts = []
        if result.reply is not None and result.artifact_action is not None:
            if on_artifact_working:
                await on_artifact_working()
            try:
                # A small bounded synchronous commit is intentional: cancellation cannot split
                # backing-file/catalog publication or report cancellation after a committed file.
                artifacts.append(artifact_store.create(result.artifact_action, operation_key, fingerprint))
            except ArtifactError as error:
                result.reply = None
                result.error = error.code
                result.warnings = [str(error)]
            except ValueError:
                result.reply = None
                result.error = "artifact_creation_failed"
                result.warnings = ["The generated file could not be saved; no ready event was emitted."]
        timeline, session.director_state = self.director.direct(
            result.reply, profile, session.director_state, now_ms=self.clock_ms()
        )

        session.history.append(ChatMessage(role="user", content=message))
        if result.reply is not None:
            session.history.append(
                ChatMessage(role="assistant", content=result.reply.model_dump_json(by_alias=True))
            )
        warnings = list(result.warnings)
        if result.error:
            warnings.append(f"provider failure: {result.error}")
        return ChatResult(result.reply, timeline.to_json(), active_gateway.info(), warnings, artifacts, result.error, result.generation)
