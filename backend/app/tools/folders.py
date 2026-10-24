"""Authorized folders tool (D-067): read-only access to folders the owner allowed in Settings."""

import json
import threading
import uuid
from pathlib import Path

from ..llm.attachments import TEXT_MAX_BYTES, _decode_text

MAX_FOLDERS = 20
MAX_LISTING = 200
#: Characters of a file sent to the model (a little under the evidence limit, to save tokens).
READ_MAX_CHARS = 60_000


class FolderError(ValueError):
    pass


class FolderStore:
    """`<config>/folders.json`: [{id, name, path}]. The allow-list is the only way in."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()

    def all(self) -> list[dict]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return []
        return [f for f in data if isinstance(f, dict) and {"id", "name", "path"} <= set(f)] if isinstance(data, list) else []

    def _save(self, folders: list[dict]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(folders, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(self.path)

    def add(self, raw_path: str) -> dict:
        try:
            root = Path(raw_path.strip()).expanduser().resolve(strict=True)
        except (OSError, RuntimeError):
            raise FolderError("That folder does not exist.") from None
        if not root.is_dir():
            raise FolderError("That path is not a folder.")
        if root == Path(root.anchor):
            raise FolderError("A whole drive cannot be authorized; choose a folder.")
        with self._lock:
            folders = self.all()
            if any(Path(f["path"]) == root for f in folders):
                raise FolderError("That folder is already authorized.")
            if len(folders) >= MAX_FOLDERS:
                raise FolderError(f"At most {MAX_FOLDERS} folders can be authorized.")
            folder = {"id": uuid.uuid4().hex[:8], "name": root.name or str(root), "path": str(root)}
            folders.append(folder)
            self._save(folders)
            return folder

    def remove(self, folder_id: str) -> bool:
        with self._lock:
            folders = self.all()
            kept = [f for f in folders if f["id"] != folder_id]
            if len(kept) == len(folders):
                return False
            self._save(kept)
            return True

    def resolve(self, folder: str, relative: str = "") -> tuple[dict, Path]:
        """Folder (id or name) + relative path → a real path that stays inside the folder."""
        match = next((f for f in self.all() if folder in (f["id"], f["name"])), None)
        if match is None:
            raise FolderError("Unknown folder. Use one of the authorized folders.")
        root = Path(match["path"]).resolve()
        relative = (relative or "").replace("\\", "/").strip().lstrip("/")
        try:
            target = (root / relative).resolve(strict=True)
        except (OSError, RuntimeError):
            raise FolderError("That path does not exist in the folder.") from None
        # resolve() follows symlinks and "..": the result must still be inside the folder.
        if target != root and root not in target.parents:
            raise FolderError("That path is outside the authorized folder.")
        return match, target


def list_folder(store: FolderStore, folder: str, relative: str = "") -> str:
    match, target = store.resolve(folder, relative)
    if not target.is_dir():
        raise FolderError("That path is a file; use file_read.")
    entries = sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    lines = []
    for entry in entries[:MAX_LISTING]:
        if entry.is_dir():
            lines.append(f"[dir]  {entry.name}/")
        else:
            try:
                lines.append(f"[file] {entry.name} ({entry.stat().st_size} bytes)")
            except OSError:
                continue
    more = f"\n… {len(entries) - MAX_LISTING} more entries not shown" if len(entries) > MAX_LISTING else ""
    where = relative or "/"
    return f'Folder "{match["name"]}", path {where}:\n' + ("\n".join(lines) or "(empty)") + more


def read_file(store: FolderStore, folder: str, relative: str) -> str:
    match, target = store.resolve(folder, relative)
    if not target.is_file():
        raise FolderError("That path is not a file.")
    raw = target.read_bytes()[: TEXT_MAX_BYTES + 1]
    text = _decode_text(raw[:TEXT_MAX_BYTES])
    if text is None:
        raise FolderError("That file is not a readable text file.")
    clipped = len(text) > READ_MAX_CHARS or len(raw) > TEXT_MAX_BYTES
    body = text[:READ_MAX_CHARS]
    return (f'File "{relative}" from folder "{match["name"]}"' + (" (truncated)" if clipped else "") + ":\n" + body)
