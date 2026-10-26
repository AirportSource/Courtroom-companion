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
from ..llm.attachments import Evidence, evidence_message, history_message
from ..llm.gateway import LLMGateway
from ..llm.schemas import ChatMessage, CharacterReply
from .context import fit_history
from .prompt import build_system_prompt, reply_schema
from .repository import CharacterRepository
from ..artifacts.contracts import turn_prompt, turn_schema
from ..artifacts.store import ArtifactError, ArtifactStore
from ..artifacts.workload import expected_workload
from ..llm.base import OutputWorkload
from ..tools.registry import ToolContext, available_tools, parse_tool_request, run_tool, tool_request_schema, tool_result_message, tools_prompt

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
    #: The tool used during this turn, if any: {"name", "ok"} (D-067).
    tool: dict[str, Any] | None = None


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
        evidence: Evidence | None = None,
        language: str = "en",
        tool_context: ToolContext | None = None,
    ) -> ChatResult:
        profile = self.repository.get_for_chat(character_id)  # raises CharacterNotFoundError / CharacterNotReadyError
        session = self._sessions.setdefault((session_id, character_id), _Session())
        # Presented evidence: the current turn carries the file (text inlined, binaries attached);
        # history keeps text evidence (bounded by fit_history) but never resends binaries.
        current = ChatMessage(role="user", content=message)
        if evidence is not None:
            current = ChatMessage(role="user", content=evidence_message(evidence, message),
                                  attachments=[evidence.attachment] if evidence.attachment else [])
        messages = [*fit_history(list(session.history)), current]

        active_gateway = gateway or self.gateway
        schema = reply_schema(profile)
        prompt = build_system_prompt(profile, language)
        if artifact_store is not None:
            schema = turn_schema(schema)
            prompt = turn_prompt(prompt, schema)
        # Tools (D-067): offered only when available for this character; at most one call per turn.
        tools = available_tools(tool_context, profile.tools)
        tool_schema = schema
        if tools:
            tool_schema = {**schema, "properties": {**schema["properties"], "toolRequest": tool_request_schema(tools)}}
        tool_prompt = "\n\n".join([prompt, tools_prompt(tools, tool_context)]) if tools else prompt
        workload = expected_workload(message, artifacts_enabled=artifact_store is not None)
        if on_expected_workload:
            on_expected_workload(workload)
        result = await active_gateway.generate_reply(tool_prompt, messages, tool_schema, workload=workload, language=language)
        tool_used = None
        request = parse_tool_request(result.raw_data, tools) if tools and result.reply is not None and result.artifact_action is None else None
        if request:
            name, arguments = request
            ok, output = await run_tool(name, arguments, tool_context, character_id)
            tool_used = {"name": name, "ok": ok}
            # Second, tool-free generation: the request and its result are given back as data.
            follow_up = [*messages,
                         ChatMessage(role="assistant", content=result.reply.model_dump_json(by_alias=True)),
                         ChatMessage(role="user", content=tool_result_message(name, ok, output))]
            result = await active_gateway.generate_reply(prompt, follow_up, schema, workload=workload, language=language)
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
            result.reply, profile, session.director_state, now_ms=self.clock_ms(), language=language
        )

        session.history.append(ChatMessage(role="user", content=history_message(evidence, message) if evidence else message))
        if result.reply is not None:
            content = result.reply.model_dump_json(by_alias=True)
            # The artifact action is not part of the reply JSON; without this note later turns see
            # "here is your file" with no file behind it and the model disowns the work.
            saved = ", ".join(str(a.get("displayName", "")) for a in artifacts if a.get("displayName"))
            if saved:
                content += f"\n[File saved and delivered to the user: {saved}]"
            session.history.append(ChatMessage(role="assistant", content=content))
        warnings = list(result.warnings)
        if result.error:
            warnings.append(f"provider failure: {result.error}")
        return ChatResult(result.reply, timeline.to_json(), active_gateway.info(), warnings, artifacts, result.error,
                          result.generation, tool_used)
