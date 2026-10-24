"""Serve the built single-page frontend (frontend/dist) from the same FastAPI process.

Used by the standalone desktop build, where one loopback server hosts both the API and the UI.
Development keeps Vite's dev server and /api proxy; nothing here runs unless mount_frontend is called.
"""

import mimetypes
import re
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response

# Explicit types: on Windows the stdlib reads the registry, which can map .js to text/plain.
MIME_TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon",
    ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".flac": "audio/flac",
    ".m4a": "audio/mp4", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
    ".otf": "font/otf", ".map": "application/json", ".txt": "text/plain; charset=utf-8",
    ".wasm": "application/wasm",
}
# Vite names bundle files <name>-<8 char content hash>.<ext> inside assets/: safe to cache forever.
HASHED_BUNDLE = re.compile(r"^assets/[^/]+-[A-Za-z0-9_-]{8}\.(?:js|css|woff2?|ttf|otf)$")
IMMUTABLE = "public, max-age=31536000, immutable"
REVALIDATE = "no-cache"


class FrontendMissingError(RuntimeError):
    """The built frontend (frontend/dist with index.html) is not available."""


def _safe_relative(path: str) -> str | None:
    """Normalised relative request path, or None when it could escape the root."""
    if "\\" in path or "\0" in path or path.startswith("/"):
        return None
    parts = [part for part in path.split("/") if part]
    if any(part in {".", ".."} or ":" in part for part in parts):
        return None
    return "/".join(parts)


def _file_response(file: Path, relative: str) -> FileResponse:
    media_type = MIME_TYPES.get(file.suffix.lower()) or mimetypes.guess_type(file.name)[0] or "application/octet-stream"
    response = FileResponse(file, media_type=media_type)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Cache-Control"] = IMMUTABLE if HASHED_BUNDLE.match(relative) else REVALIDATE
    return response


def mount_frontend(app: FastAPI, dist_dir: Path) -> None:
    """Add the SPA catch-all. Call after every API router so /api routes always win.

    Existing files are served as-is; unknown extension-less paths (client-side routes) get index.html;
    unknown paths with a file extension and anything under /api stay a plain 404.
    """
    root = Path(dist_dir).resolve()
    index = root / "index.html"
    if not root.is_dir() or not index.is_file():
        raise FrontendMissingError(f"Built frontend not found: expected {index}. Run `npm run build` in frontend/.")

    def serve(path: str) -> Response:
        if path == "api" or path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        relative = _safe_relative(path)
        if relative is None:
            raise HTTPException(status_code=404, detail="Not Found")
        if relative:
            candidate = (root / relative).resolve()
            if candidate.is_file() and candidate.is_relative_to(root):
                return _file_response(candidate, relative)
            if "." in relative.rsplit("/", 1)[-1]:
                raise HTTPException(status_code=404, detail="Not Found")
        return _file_response(index, "index.html")

    app.add_api_route("/{path:path}", serve, methods=["GET", "HEAD"], include_in_schema=False)
