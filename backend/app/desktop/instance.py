"""Single-instance guard: a named Windows mutex plus ``instance.json`` {port, pid}.

The mutex decides who is the primary instance; the file tells a second launch where to find it.
A file whose process is dead or whose port does not answer ``/api/health`` is stale and ignored.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

ERROR_ALREADY_EXISTS = 183
INSTANCE_FILE = "instance.json"


@dataclass(frozen=True)
class InstanceInfo:
    port: int
    pid: int

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}/"


# --- OS seams -------------------------------------------------------------------------------

def create_named_mutex(name: str) -> tuple[object | None, bool]:
    """Return (handle, already_exists). Non-Windows: no mutex, never 'already exists'."""
    if sys.platform != "win32":
        return None, False
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateMutexW.argtypes = [wintypes.LPVOID, wintypes.BOOL, wintypes.LPCWSTR]
    kernel32.CreateMutexW.restype = wintypes.HANDLE
    handle = kernel32.CreateMutexW(None, False, name)
    if not handle:
        raise OSError(ctypes.get_last_error(), "CreateMutexW failed")
    return handle, ctypes.get_last_error() == ERROR_ALREADY_EXISTS


def close_handle(handle: object | None) -> None:
    if handle is None or sys.platform != "win32":
        return
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32")
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle(handle)


def pid_is_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if sys.platform != "win32":
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.GetExitCodeProcess.argtypes = [wintypes.HANDLE, wintypes.LPDWORD]
    handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return False
    try:
        code = wintypes.DWORD()
        return bool(kernel32.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value == 259  # STILL_ACTIVE
    finally:
        kernel32.CloseHandle(handle)


def probe_health(port: int, timeout: float = 2.0) -> bool:
    """True when a Courtroom Companion backend answers /api/health on loopback."""
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(f"http://127.0.0.1:{port}/api/health", timeout=timeout) as response:
            payload = json.loads(response.read(65536))
            return response.status == 200 and payload.get("status") == "ok"
    except Exception:
        return False


# --- instance file --------------------------------------------------------------------------

def mutex_name_for(directory: Path) -> str:
    digest = hashlib.sha1(os.path.normcase(os.path.abspath(directory)).encode("utf-8")).hexdigest()[:12]
    return f"Local\\CourtroomCompanion-{digest}"


def read_instance(path: Path) -> InstanceInfo | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        port, pid = int(data["port"]), int(data["pid"])
    except (OSError, ValueError, KeyError, TypeError):
        return None
    if not (0 < port < 65536) or pid <= 0:
        return None
    return InstanceInfo(port=port, pid=pid)


class SingleInstance:
    def __init__(
        self,
        directory: Path,
        *,
        mutex_factory: Callable[[str], tuple[object | None, bool]] = create_named_mutex,
        pid_alive: Callable[[int], bool] = pid_is_alive,
        health: Callable[[int], bool] = probe_health,
        closer: Callable[[object | None], None] = close_handle,
    ) -> None:
        self.directory = directory
        self.path = directory / INSTANCE_FILE
        self._mutex_factory = mutex_factory
        self._pid_alive = pid_alive
        self._health = health
        self._closer = closer
        self._handle: object | None = None
        self.owned = False

    def acquire(self) -> bool:
        """True when this process is the primary instance."""
        handle, already = self._mutex_factory(mutex_name_for(self.directory))
        if already:
            self._closer(handle)
            return False
        self._handle = handle
        self.owned = True
        return True

    def live_instance(self) -> InstanceInfo | None:
        """The running instance described by the file, or None when missing/stale."""
        info = read_instance(self.path)
        if info is None or info.pid == os.getpid():
            return None
        if not self._pid_alive(info.pid) or not self._health(info.port):
            return None
        return info

    def wait_for_instance(self, timeout: float, interval: float = 0.25,
                          sleep: Callable[[float], None] = time.sleep,
                          clock: Callable[[], float] = time.monotonic) -> InstanceInfo | None:
        """Used by a second launch while the primary is still starting up."""
        deadline = clock() + timeout
        while True:
            info = self.live_instance()
            if info or clock() >= deadline:
                return info
            sleep(interval)

    def write(self, port: int) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"port": port, "pid": os.getpid()}), encoding="utf-8")
        os.replace(tmp, self.path)

    def release(self) -> None:
        info = read_instance(self.path)
        if info is not None and info.pid == os.getpid():
            try:
                self.path.unlink()
            except OSError:
                pass
        if self.owned:
            self._closer(self._handle)
            self._handle = None
            self.owned = False
