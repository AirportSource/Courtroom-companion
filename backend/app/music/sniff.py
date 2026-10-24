"""Content-based audio detection and filename sanitising. Extensions and MIME types are never trusted."""

import re
from dataclasses import dataclass
from urllib.parse import unquote

MAX_TITLE_LENGTH = 80
DEFAULT_TITLE = "Imported track"
SNIFF_BYTES = 16

_RESERVED_NAMES = {"con", "prn", "aux", "nul", *(f"com{n}" for n in range(1, 10)),
                   *(f"lpt{n}" for n in range(1, 10))}


@dataclass(frozen=True)
class AudioFormat:
    name: str
    extension: str
    mime: str


MP3 = AudioFormat("mp3", "mp3", "audio/mpeg")
OGG = AudioFormat("ogg", "ogg", "audio/ogg")
WAV = AudioFormat("wav", "wav", "audio/wav")
FLAC = AudioFormat("flac", "flac", "audio/flac")
FORMATS = {item.name: item for item in (MP3, OGG, WAV, FLAC)}


def _mp3_frame_sync(head: bytes) -> bool:
    if len(head) < 4 or head[0] != 0xFF or (head[1] & 0xE0) != 0xE0:
        return False
    version, layer = (head[1] >> 3) & 3, (head[1] >> 1) & 3
    bitrate, rate = (head[2] >> 4) & 15, (head[2] >> 2) & 3
    return version != 1 and layer != 0 and bitrate != 15 and rate != 3


def sniff_audio(head: bytes) -> AudioFormat | None:
    """Identify MP3 / OGG / WAV / FLAC from the first bytes, or None."""
    if head[:3] == b"ID3" or _mp3_frame_sync(head):
        return MP3
    if head[:4] == b"OggS":
        return OGG
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return WAV
    if head[:4] == b"fLaC":
        return FLAC
    return None


def sanitize_title(raw: str | None) -> str:
    """Display title from an untrusted, optionally percent-encoded file name."""
    text = unquote(raw or "", errors="replace")
    text = text.replace("\x00", "")
    text = re.split(r"[\\/]", text)[-1]  # drop any directory part, either separator style
    text = re.sub(r"\.(mp3|ogg|oga|wav|wave|flac)$", "", text, flags=re.IGNORECASE)
    text = "".join(ch for ch in text if ch.isprintable())
    text = re.sub(r'[<>:"|?*‪-‮⁦-⁩]', " ", text)
    text = re.sub(r"\s+", " ", text).strip(" .")
    text = text[:MAX_TITLE_LENGTH].strip(" .")
    if not text or text.lower().split(".")[0] in _RESERVED_NAMES:
        return DEFAULT_TITLE
    return text
