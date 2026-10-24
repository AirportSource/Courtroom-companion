"""Rotating file logging with secret redaction, safe when stdout/stderr do not exist.

A windowed (console=False) executable has ``sys.stdout``/``sys.stderr`` set to None, so nothing
may rely on them. Records pass through a redaction layer before they reach any handler.
"""

from __future__ import annotations

import logging
import os
import re
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

LOG_FILE_NAME = "courtroom-companion.log"
MAX_BYTES = 1_000_000
BACKUP_COUNT = 3
REDACTED = "[REDACTED]"

_PATTERNS = [
    # Header-style "Authorization: Bearer xyz", "x-api-key: xyz", "Proxy-Authorization: ..."
    (re.compile(r"(?i)((?:proxy-)?authorization|x-api-key|api-key)(['\"]?\s*[:=]\s*['\"]?)(?:bearer\s+|basic\s+)?[^\s,;'\"}]+"),
     r"\1\2" + REDACTED),
    # key=value / "key": "value" for common secret field names
    (re.compile(r"(?i)((?:api[_-]?key|secret|password|passwd|token|credential)s?['\"]?\s*[:=]\s*['\"]?)[^\s,;'\"}&]+"),
     r"\1" + REDACTED),
    # Bare bearer tokens and well-known key shapes
    (re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{8,}"), "Bearer " + REDACTED),
    (re.compile(r"\bsk-[A-Za-z0-9_-]{8,}"), REDACTED),
]


def redact(text: str) -> str:
    for pattern, replacement in _PATTERNS:
        text = pattern.sub(replacement, text)
    return text


class RedactionFilter(logging.Filter):
    """Resolves the message once and scrubs it before formatting."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            record.msg = redact(record.getMessage())
        except Exception:
            record.msg = REDACTED
        record.args = None
        return True


class RedactingFormatter(logging.Formatter):
    """Also scrubs tracebacks, which the filter never sees."""

    def format(self, record: logging.LogRecord) -> str:
        return redact(super().format(record))


FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"


def ensure_std_streams() -> None:
    """Give a windowed build harmless stdout/stderr so no library writes to None."""
    for name in ("stdout", "stderr"):
        if getattr(sys, name) is None:
            setattr(sys, name, open(os.devnull, "w", encoding="utf-8"))


def configure_logging(log_dir: Path, *, console: bool = False, level: int = logging.INFO) -> Path:
    """Install root handlers. Call BEFORE importing app.main (its basicConfig is then a no-op)."""
    ensure_std_streams()
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / LOG_FILE_NAME
    root = logging.getLogger()
    for handler in list(root.handlers):
        root.removeHandler(handler)
    formatter = RedactingFormatter(FORMAT)
    handlers: list[logging.Handler] = [
        RotatingFileHandler(log_path, maxBytes=MAX_BYTES, backupCount=BACKUP_COUNT, encoding="utf-8")
    ]
    if console:
        handlers.append(logging.StreamHandler(sys.stderr))
    for handler in handlers:
        handler.setFormatter(formatter)
        handler.addFilter(RedactionFilter())
        root.addHandler(handler)
    root.setLevel(level)
    # httpx logs full request URLs at INFO; keep provider traffic quiet.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    return log_path
