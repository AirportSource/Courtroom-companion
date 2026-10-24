r"""Single source of truth for where the backend reads bundled resources and writes user data.

Two kinds of locations are kept strictly apart:

- IMMUTABLE bundled resources (frontend build, character packs): ``resource_root()``,
  ``frontend_dist_dir()``, ``assets_dir()``. Read-only; in a PyInstaller build they live inside
  the bundle (``sys._MEIPASS``, a temporary directory for one-file builds).
- MUTABLE user data (profiles, outputs, music, conversation record, logs, instance lock):
  ``data_root()`` and the helpers derived from it. Never inside the bundle or beside the executable.

Precedence for every mutable location (first match wins):

1. the store's own env var (``COURTROOM_OUTPUTS_DIR``, ``COURTROOM_MUSIC_DIR``,
   ``COURTROOM_CONVERSATION_RECORD_DIR``, ``COURTROOM_LOG_DIR``)
2. ``COURTROOM_CONFIG_DIR`` as the base directory (tests and custom installs)
3. frozen build: ``%LOCALAPPDATA%\CourtroomCompanion`` (non-Windows: ``$XDG_DATA_HOME`` or
   ``~/.local/share``)
4. development: repository-local ``backend/.local`` (existing dev data is never moved)

Resources: ``COURTROOM_FRONTEND_DIST`` / ``COURTROOM_ASSETS_DIR`` override, then
``_MEIPASS/frontend_dist`` (frozen) or the repository ``frontend/dist`` / ``frontend/public/assets``.

Everything is evaluated at call time (environment is read on each call). Resolution never creates
directories; callers create them when writing.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

APP_NAME = "CourtroomCompanion"

_REPO_ROOT = Path(__file__).resolve().parents[3]


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def _env_path(name: str) -> Path | None:
    value = os.environ.get(name)
    return Path(value) if value else None


def resource_root() -> Path:
    if is_frozen():
        return Path(getattr(sys, "_MEIPASS", None) or Path(sys.executable).resolve().parent)
    return _REPO_ROOT


def frontend_dist_dir() -> Path:
    return (
        _env_path("COURTROOM_FRONTEND_DIST")
        or (resource_root() / "frontend_dist" if is_frozen() else _REPO_ROOT / "frontend" / "dist")
    )


def assets_dir() -> Path:
    explicit = _env_path("COURTROOM_ASSETS_DIR")
    if explicit:
        return explicit
    if is_frozen():
        return frontend_dist_dir() / "assets"
    return _REPO_ROOT / "frontend" / "public" / "assets"


def assert_writable_location(path: Path) -> Path:
    """Raise if a mutable path would land inside the read-only bundle (frozen builds only)."""
    if is_frozen():
        resolved = Path(os.path.abspath(path))
        root = Path(os.path.abspath(resource_root()))
        if resolved == root or root in resolved.parents:
            raise RuntimeError("Refusing to use application resource directory for user data.")
    return path


def _frozen_data_root() -> Path:
    if sys.platform == "win32":
        local = os.environ.get("LOCALAPPDATA")
        base = Path(local) if local else Path.home() / "AppData" / "Local"
    else:
        xdg = os.environ.get("XDG_DATA_HOME")
        base = Path(xdg) if xdg else Path.home() / ".local" / "share"
    return base / APP_NAME


def data_root() -> Path:
    path = _env_path("COURTROOM_CONFIG_DIR")
    if path is None:
        path = _frozen_data_root() if is_frozen() else _REPO_ROOT / "backend" / ".local"
    return assert_writable_location(path)


def config_dir() -> Path:
    explicit = _env_path("COURTROOM_CONFIG_DIR")
    if explicit or not is_frozen():
        return data_root()
    return assert_writable_location(data_root() / "config")


def _data_child(env_name: str | None, name: str) -> Path:
    explicit = _env_path(env_name) if env_name else None
    return assert_writable_location(explicit or data_root() / name)


def outputs_dir() -> Path:
    return _data_child("COURTROOM_OUTPUTS_DIR", "outputs")


def music_dir() -> Path:
    return _data_child("COURTROOM_MUSIC_DIR", "music")


def conversation_record_dir() -> Path:
    return _data_child("COURTROOM_CONVERSATION_RECORD_DIR", "conversation-record")


def logs_dir() -> Path:
    return _data_child("COURTROOM_LOG_DIR", "logs")


def instance_dir() -> Path:
    return _data_child(None, "instance")


def describe_paths() -> dict[str, str]:
    """Resolved locations for diagnostics (paths only; no secrets)."""
    return {
        "frozen": str(is_frozen()),
        "resource_root": str(resource_root()),
        "frontend_dist": str(frontend_dist_dir()),
        "assets": str(assets_dir()),
        "data_root": str(data_root()),
        "config": str(config_dir()),
        "outputs": str(outputs_dir()),
        "music": str(music_dir()),
        "conversation_record": str(conversation_record_dir()),
        "logs": str(logs_dir()),
        "instance": str(instance_dir()),
    }
