"""Reminders tool (D-067): stored locally, delivered through the event inbox when due."""

import json
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

MAX_PENDING = 50
TEXT_MAX = 200
MAX_AHEAD = timedelta(days=366)


class ReminderError(ValueError):
    pass


class ReminderStore:
    """`<config>/reminders.json`: [{id, due (UTC ISO), text, character, created}]. Thread-safe."""

    def __init__(self, path: Path, clock=lambda: datetime.now(timezone.utc)) -> None:
        self.path, self._clock = path, clock
        self._lock = threading.Lock()

    def _load(self) -> list[dict]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return []
        return [r for r in data if isinstance(r, dict) and {"id", "due", "text"} <= set(r)] if isinstance(data, list) else []

    def _save(self, reminders: list[dict]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(reminders, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(self.path)

    def create(self, due: datetime, text: str, character: str = "") -> dict:
        text = " ".join(str(text).split())[:TEXT_MAX]
        if not text:
            raise ReminderError("A reminder needs a text.")
        now = self._clock()
        if due.tzinfo is None:
            raise ReminderError("The reminder time needs a time zone.")
        if due <= now:
            raise ReminderError("That time is already past.")
        if due - now > MAX_AHEAD:
            raise ReminderError("Reminders can be set at most one year ahead.")
        with self._lock:
            reminders = self._load()
            if len(reminders) >= MAX_PENDING:
                raise ReminderError(f"There are already {MAX_PENDING} pending reminders.")
            reminder = {"id": uuid.uuid4().hex[:8], "due": due.astimezone(timezone.utc).isoformat(), "text": text,
                        "character": character, "created": now.isoformat()}
            reminders.append(reminder)
            self._save(reminders)
            return reminder

    def pending(self) -> list[dict]:
        with self._lock:
            return sorted(self._load(), key=lambda r: r["due"])

    def cancel(self, reminder_id: str) -> bool:
        with self._lock:
            reminders = self._load()
            kept = [r for r in reminders if r["id"] != reminder_id]
            if len(kept) == len(reminders):
                return False
            self._save(kept)
            return True

    def pop_due(self) -> list[dict]:
        """Remove and return reminders whose time has come."""
        now = self._clock().isoformat()
        with self._lock:
            reminders = self._load()
            due = [r for r in reminders if r["due"] <= now]
            if due:
                self._save([r for r in reminders if r["due"] > now])
            return due


def parse_when(arguments: dict, now: datetime) -> datetime:
    """`in_minutes` (number) or `when` (ISO 8601; naive = the machine's local time)."""
    minutes = arguments.get("in_minutes")
    if isinstance(minutes, (int, float)) and not isinstance(minutes, bool):
        if not 0 < minutes <= MAX_AHEAD.total_seconds() / 60:
            raise ReminderError("in_minutes must be between 1 and 527040.")
        return now + timedelta(minutes=float(minutes))
    when = arguments.get("when")
    if not isinstance(when, str) or not when.strip():
        raise ReminderError("Give either 'when' (ISO date and time) or 'in_minutes'.")
    try:
        due = datetime.fromisoformat(when.strip().replace("Z", "+00:00"))
    except ValueError:
        raise ReminderError("'when' must be an ISO date and time such as 2026-10-25T15:00.") from None
    return due if due.tzinfo else due.astimezone()  # naive → local time zone of this machine


def local_label(iso_utc: str) -> str:
    return datetime.fromisoformat(iso_utc).astimezone().strftime("%Y-%m-%d %H:%M")
