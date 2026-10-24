"""One-file builds: shut down when the bootloader parent disappears.

A PyInstaller one-file exe is a bootloader process that unpacks to a temp dir and runs the real
program as a child. Ending only the bootloader (Task Manager, TerminateProcess) leaves that child
running, so the child watches its parent and exits cleanly when it is gone.
"""

from __future__ import annotations

import logging
import os
import sys
import threading
from pathlib import Path
from typing import Callable

log = logging.getLogger("courtroom.desktop")

SYNCHRONIZE = 0x00100000
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
WAIT_OBJECT_0 = 0
POLL_MS = 1000


def is_onefile() -> bool:
    """Frozen with the unpack directory outside the executable's folder (onedir keeps it inside)."""
    if not getattr(sys, "frozen", False):
        return False
    meipass = getattr(sys, "_MEIPASS", None)
    if not meipass:
        return False
    try:
        exe_dir = Path(os.path.abspath(sys.executable)).parent
        unpack = Path(os.path.abspath(meipass))
    except OSError:
        return False
    return exe_dir != unpack and exe_dir not in unpack.parents


def _same_path(a: str, b: str) -> bool:
    return os.path.normcase(os.path.abspath(a)) == os.path.normcase(os.path.abspath(b))


def open_parent_handle(executable: str | None = None) -> object | None:
    """SYNCHRONIZE handle to the parent, only when it is this same executable (the bootloader)."""
    if sys.platform != "win32":
        return None
    import ctypes
    from ctypes import wintypes

    executable = executable or sys.executable
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR,
                                                    ctypes.POINTER(wintypes.DWORD)]
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel32.OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, False, os.getppid())
    if not handle:
        return None
    buffer = ctypes.create_unicode_buffer(32768)
    size = wintypes.DWORD(len(buffer))
    if kernel32.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)) and _same_path(buffer.value, executable):
        return handle
    kernel32.CloseHandle(handle)  # unrelated parent (e.g. a shell) or PID reuse: do not follow it
    return None


def wait_for_handle(handle: object, timeout_ms: int) -> bool:
    """True when the process behind `handle` has exited."""
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel32.WaitForSingleObject.restype = wintypes.DWORD
    return kernel32.WaitForSingleObject(handle, timeout_ms) == WAIT_OBJECT_0


def watch_parent(
    stop: Callable[[], None],
    done: threading.Event,
    *,
    opener: Callable[[], object | None] = open_parent_handle,
    waiter: Callable[[object, int], bool] = wait_for_handle,
    closer: Callable[[object | None], None] | None = None,
    poll_ms: int = POLL_MS,
) -> bool:
    """Blocks until `done` or the parent exits (then calls `stop`). Returns True if stop was called."""
    if closer is None:
        from .instance import close_handle as closer
    handle = opener()
    if handle is None:
        log.info("Parent process is not the one-file bootloader; parent watch disabled.")
        return False
    try:
        while not done.is_set():
            if waiter(handle, poll_ms):
                log.info("Parent process exited; shutting down.")
                stop()
                return True
        return False
    finally:
        closer(handle)
