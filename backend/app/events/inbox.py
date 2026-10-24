"""Event inbox (D-067): things a character may comment on without a user message.

Events come from local sources only (Claude Code hooks, the reminder scheduler, tools). They are
kept in a small in-memory ring buffer with increasing ids and never persisted. The frontend polls
`GET /api/events?after=<id>` and, at fetch time, each event is turned into a ready performance for
the character on screen and the interface language: the line comes from that character's
`performance.json` `eventLines` and goes through the normal CharacterDirector, so emotions,
reactions and sounds behave exactly like a reply. No model is called.
"""

import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from ..characters.repository import CharacterProfile
from ..director.director import CharacterDirector, DirectorState
from ..llm.schemas import Beat, CharacterReply

#: Event types the app understands (anything else is rejected at the API).
EVENT_TYPES = frozenset({
    "task_finished", "needs_attention", "tests_passed", "tests_failed", "build_failed", "session_started",
    "reminder_due",
})
#: Types that should also ring the phone to draw attention.
ATTENTION_TYPES = frozenset({"needs_attention", "reminder_due"})
EXCLAMATIONS = frozenset({"objection", "hold_it", "take_that"})
BUFFER_SIZE = 100
RATE_LIMIT_PER_MINUTE = 60
TEXT_MAX = 300
PROJECT_MAX = 80

#: Used when a character has no line for an event type (kept neutral, any character).
DEFAULT_LINES: dict[str, dict[str, str]] = {
    "en": {"task_finished": "That task is finished.", "needs_attention": "Claude Code is waiting for you.",
           "tests_passed": "The tests passed!", "tests_failed": "Some tests failed.", "build_failed": "The build failed.",
           "session_started": "A new Claude Code session started.", "reminder_due": "Reminder: {text}"},
}


class EventRejected(ValueError):
    pass


@dataclass
class Event:
    id: int
    type: str
    source: str
    created_at: float
    project: str = ""
    text: str = ""
    details: dict[str, Any] = field(default_factory=dict)


class EventInbox:
    def __init__(self, clock=time.time) -> None:
        self._events: deque[Event] = deque(maxlen=BUFFER_SIZE)
        self._next_id = 1
        self._recent: deque[float] = deque()
        self._lock = threading.Lock()
        self._clock = clock

    def push(self, type: str, source: str, project: str = "", text: str = "", **details: Any) -> Event:
        if type not in EVENT_TYPES:
            raise EventRejected(f"unknown event type: {type}")
        now = self._clock()
        with self._lock:
            while self._recent and now - self._recent[0] > 60:
                self._recent.popleft()
            if len(self._recent) >= RATE_LIMIT_PER_MINUTE:
                raise EventRejected("too many events")
            self._recent.append(now)
            event = Event(self._next_id, type, source[:40], now, project[:PROJECT_MAX], text[:TEXT_MAX], details)
            self._next_id += 1
            self._events.append(event)
            return event

    def after(self, event_id: int) -> list[Event]:
        with self._lock:
            return [event for event in self._events if event.id > event_id]

    @property
    def last_id(self) -> int:
        with self._lock:
            return self._next_id - 1

    def start_cursor(self, keep_seconds: float = 900) -> int:
        """Cursor for a newly opened conversation: skip old events, except recent due reminders."""
        now = self._clock()
        with self._lock:
            recent = [e.id for e in self._events if e.type == "reminder_due" and now - e.created_at <= keep_seconds]
            return min(recent) - 1 if recent else self._next_id - 1


def _fill(template: str, event: Event) -> str:
    text = template.replace("{text}", event.text or "…").replace("{project}", event.project or "")
    return " ".join(text.split())[:600]


def event_line(profile: CharacterProfile, event: Event, language: str) -> dict[str, Any]:
    """The character's line variant for this event (rotating by event id), with fallbacks."""
    by_language = profile.event_lines.get(event.type, {})
    variants = by_language.get(language) or by_language.get("en") or []
    if variants:
        line = dict(variants[event.id % len(variants)])
    else:
        line = {"text": DEFAULT_LINES["en"][event.type], "emotion": profile.default_emotion}
    line["text"] = _fill(str(line.get("text", "")), event)
    return line


def event_performance(profile: CharacterProfile, event: Event, language: str,
                      director: CharacterDirector | None = None) -> dict[str, Any]:
    line = event_line(profile, event, language)
    beat = Beat(text=line["text"] or "…", emotion=str(line.get("emotion", "")),
                intensity=float(line.get("intensity", 0.6)), reaction=line.get("reaction"))
    timeline, _ = (director or CharacterDirector()).direct(CharacterReply(beats=[beat]), profile, DirectorState(),
                                                           language=language)
    exclamation = line.get("exclamation")
    return {
        "id": event.id, "type": event.type, "source": event.source, "project": event.project,
        "attention": event.type in ATTENTION_TYPES,
        "exclamation": exclamation if exclamation in EXCLAMATIONS else None,
        "performance": timeline.to_json(),
    }
