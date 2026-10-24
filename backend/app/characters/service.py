"""Character Service: orchestrates one conversational turn.

user message -> character context (prompt + schema) -> LLM gateway (any provider)
-> validated CharacterReply -> Character Director -> PerformanceTimeline.

Conversation context is a small in-memory history per (session, character). Future
long-term memory / retrieval would plug in here, when building the message list.
"""

import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from ..director.director import CharacterDirector, DirectorState
from ..llm.gateway import LLMGateway
from ..llm.schemas import ChatMessage, CharacterReply
from .prompt import build_system_prompt, reply_schema
from .repository import CharacterRepository

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
    ) -> ChatResult:
        profile = self.repository.get(character_id)  # raises CharacterNotFoundError
        session = self._sessions.setdefault((session_id, character_id), _Session())
        messages = [*session.history, ChatMessage(role="user", content=message)]

        active_gateway = gateway or self.gateway
        result = await active_gateway.generate_reply(build_system_prompt(profile), messages, reply_schema(profile))
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
        return ChatResult(result.reply, timeline.to_json(), active_gateway.info(), warnings)
