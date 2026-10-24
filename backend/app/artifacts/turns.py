"""Bounded local turn lifecycle and idempotency; no provider-specific behavior."""

import asyncio
import hashlib
import json
from dataclasses import dataclass, field

from ..characters.service import ChatResult

MAX_TURNS = 256


class TurnConflict(ValueError):
    pass


class TurnCancelled(ValueError):
    pass


def request_fingerprint(character: str, message: str, session_id: str) -> str:
    return hashlib.sha256(json.dumps([character, message, session_id], ensure_ascii=False).encode("utf-8")).hexdigest()


@dataclass
class Turn:
    id: str
    fingerprint: str | None
    state: str = "working"
    cue: str | None = None
    error: str | None = None
    artifact_id: str | None = None
    cues: list[str] = field(default_factory=list)
    job: asyncio.Task | None = None

    def public(self) -> dict:
        return {"id": self.id, "state": self.state, "cue": self.cue, "error": self.error,
                "artifactId": self.artifact_id, "cues": list(self.cues)}

    async def artifact_working(self):
        self.cue = "artifact_working"
        self.cues.append(self.cue)
        # Give explicit cancellation a checkpoint before the atomic small-file commit.
        await asyncio.sleep(0)


class TurnRegistry:
    def __init__(self):
        self.turns: dict[str, Turn] = {}

    def _room(self):
        if len(self.turns) >= MAX_TURNS:
            completed = next((key for key, value in self.turns.items() if value.job is None or value.job.done()), None)
            if completed is None:
                raise TurnConflict("Too many turns are currently running.")
            del self.turns[completed]

    async def run(self, turn_id: str, fingerprint: str, operation) -> tuple[ChatResult, dict]:
        # No await between lookup and insertion; one event loop owns this local registry.
        turn = self.turns.get(turn_id)
        if turn:
            if turn.error == "cancelled":
                raise TurnCancelled()
            if turn.error == "artifact_not_found":
                raise TurnConflict("The generated file for this turn is no longer available.")
            if turn.fingerprint != fingerprint:
                raise TurnConflict("That request ID was already used for a different turn.")
        else:
            self._room()
            turn = Turn(turn_id, fingerprint)
            self.turns[turn_id] = turn

            async def perform():
                try:
                    result = await operation(turn)
                    turn.error = result.error
                    if result.error:
                        turn.state, turn.cue = "failed", None
                    elif result.artifacts:
                        turn.state, turn.cue = "artifact-ready", "artifact_ready"
                        turn.artifact_id = result.artifacts[0]["id"]
                        turn.cues.append(turn.cue)
                    else:
                        turn.state, turn.cue = "idle", None
                    return result
                except asyncio.CancelledError:
                    turn.state, turn.cue, turn.error = "failed", None, "cancelled"
                    raise
                except Exception:
                    turn.state, turn.cue, turn.error = "failed", None, "turn_failed"
                    raise

            turn.job = asyncio.create_task(perform())
        try:
            result = await asyncio.shield(turn.job)
        except asyncio.CancelledError:
            if turn.error == "cancelled":
                raise TurnCancelled() from None
            raise
        return result, turn.public()

    def get(self, turn_id: str) -> dict | None:
        turn = self.turns.get(turn_id)
        return turn.public() if turn else None

    def invalidate_artifact(self, artifact_id: str):
        for turn in self.turns.values():
            if turn.artifact_id == artifact_id:
                turn.state, turn.cue, turn.error, turn.artifact_id = "failed", None, "artifact_not_found", None
                turn.cues = [cue for cue in turn.cues if cue != "artifact_ready"]

    def cancel(self, turn_id: str) -> dict:
        turn = self.turns.get(turn_id)
        if turn is None:
            self._room()
            # Cancellation may reach the server before POST /chat; remember it.
            turn = Turn(turn_id, None, state="failed", error="cancelled")
            self.turns[turn_id] = turn
        elif turn.state == "working":
            turn.state, turn.cue, turn.error = "failed", None, "cancelled"
            if turn.job:
                turn.job.cancel()
        return turn.public()
