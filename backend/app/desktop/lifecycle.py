"""Heartbeat-driven lifetime: the browser tab keeps the backend alive; silence stops it."""

from __future__ import annotations

import logging
import threading
import time
from typing import Callable

from fastapi import APIRouter, Depends, Response

from ..api.profile_routes import local_configuration_request
from . import APP_VERSION

log = logging.getLogger("courtroom.desktop")

HEARTBEAT_INTERVAL_MS = 15_000
# Chrome throttles background timers to roughly once a minute; two minutes tolerates that.
GRACE_AFTER_CONNECT_S = 120.0
GRACE_NEVER_CONNECTED_S = 600.0
# A watchdog tick gap this large means the machine slept; do not count it as silence.
RESUME_GAP_S = 30.0


class HeartbeatMonitor:
    def __init__(self, *, clock: Callable[[], float] = time.monotonic,
                 grace_after_connect: float = GRACE_AFTER_CONNECT_S,
                 grace_never_connected: float = GRACE_NEVER_CONNECTED_S) -> None:
        self._clock = clock
        self._grace_connected = grace_after_connect
        self._grace_never = grace_never_connected
        self._lock = threading.Lock()
        self._started = clock()
        self._last_beat: float | None = None

    def beat(self) -> None:
        with self._lock:
            self._last_beat = self._clock()

    def forgive(self) -> None:
        """Restart the silence window (system resume)."""
        with self._lock:
            now = self._clock()
            self._started = now
            if self._last_beat is not None:
                self._last_beat = now

    @property
    def connected(self) -> bool:
        return self._last_beat is not None

    def expired(self) -> bool:
        with self._lock:
            now = self._clock()
            if self._last_beat is None:
                return now - self._started > self._grace_never
            return now - self._last_beat > self._grace_connected


def run_watchdog(monitor: HeartbeatMonitor, stop: Callable[[], None], done: threading.Event,
                 *, poll_s: float = 2.0, clock: Callable[[], float] = time.monotonic) -> None:
    """Blocks until `done` is set or the monitor expires (then calls `stop` once)."""
    last_tick = clock()
    while not done.wait(poll_s):
        now = clock()
        if now - last_tick > RESUME_GAP_S:
            log.info("Detected system resume; heartbeat window restarted.")
            monitor.forgive()
        last_tick = now
        if monitor.expired():
            log.info("No browser heartbeat; shutting down.")
            stop()
            return


NO_STORE_HEADERS = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}


def _no_store(response: Response) -> None:
    response.headers.update(NO_STORE_HEADERS)


def create_desktop_router(monitor: HeartbeatMonitor) -> APIRouter:
    router = APIRouter(prefix="/api/app", dependencies=[Depends(local_configuration_request), Depends(_no_store)])

    @router.get("/info")
    def info() -> dict:
        return {"desktop": True, "heartbeatIntervalMs": HEARTBEAT_INTERVAL_MS, "version": APP_VERSION}

    @router.post("/heartbeat", status_code=204)
    def heartbeat() -> Response:
        monitor.beat()
        return Response(status_code=204, headers=NO_STORE_HEADERS)

    return router
