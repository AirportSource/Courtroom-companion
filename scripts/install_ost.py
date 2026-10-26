#!/usr/bin/env python3
"""Install original-soundtrack MP3s for the built-in music player (D-044, D-071; the MP3s are not stored in Git).

Run from the repository root, giving one or more SOURCES (a .zip or a folder each):

    python scripts/install_ost.py path/to/pwaa-original-soundtrack.zip
    python scripts/install_ost.py path/to/ace-attorney-original-soundtrack-remastered.zip
    python scripts/install_ost.py "path/to/game_soundtrack"            # folder holding "Disc 1", "Disc 2", "Disc 3"
    python scripts/install_ost.py a.zip "path/to/Disc 2" "path/to/Disc 3"
    python scripts/install_ost.py --dry-run <source>...                  # show what would be copied

Two kinds of source are understood, and they can be mixed:

* the original PWAA soundtrack ZIP (https://archive.org/details/pwaa-original-soundtrack, 38 MP3 named
  "NN. Title.mp3"): installs the 25 Ace Attorney tracks (manifest entries without "disc") by OST number;
* the Trilogy "Original Soundtrack Remastered" release (3 discs; "Disc 1", "Disc 2", "Disc 3" folders, or a ZIP
  containing them): installs Justice for All (disc 2) and Trials and Tribulations (disc 3) tracks by disc and
  track number. Its Disc 1 is NOT used for the Ace Attorney tracks unless --disc1-substitute is given: the
  built-in loop points of those tracks were measured on the PWAA zip's encodes (the remaster differs by up to
  ~1 s in length), so substituting them can misplace the loops.

Only the tracks with a "src" in frontend/public/assets/music/soundtrack.json are copied, unchanged, to
frontend/public/assets/music/original/ (git-ignored). Sources are only read, never modified. Runtime code
never references the source location. Standard library only.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parents[1]
MUSIC = ROOT / "frontend" / "public" / "assets" / "music"

LEGACY = 0  # pseudo-disc of a member that has no "Disc N" in its path (the PWAA zip)


@dataclass
class Member:
    disc: int
    number: int
    key: str  # normalised title (letters and digits only)
    label: str
    read: Callable[[], bytes]


def normalise(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", text)


def parse_member(parts: tuple[str, ...], read: Callable[[], bytes]) -> Member | None:
    name = parts[-1]
    match = re.match(r"(\d+)\.\s*(.*)\.mp3$", name, re.IGNORECASE)
    if not match or "__MACOSX" in parts or name.startswith("._"):
        return None
    disc = LEGACY
    for part in parts[:-1]:
        found = re.fullmatch(r"\s*disc\s*(\d+)\s*", part, re.IGNORECASE)
        if found:
            disc = int(found.group(1))
    return Member(disc, int(match.group(1)), normalise(match.group(2).replace(".flac", "")), "/".join(parts), read)


def scan(source: Path) -> list[Member]:
    members: list[Member] = []
    if source.is_dir():
        for path in sorted(source.rglob("*.mp3")):
            parts = (*source.parts[-1:], *path.relative_to(source).parts)
            member = parse_member(parts, path.read_bytes)
            if member:
                members.append(member)
    else:
        archive = zipfile.ZipFile(source)
        for info in archive.infolist():
            if info.is_dir():
                continue
            member = parse_member(tuple(Path(info.filename).parts), lambda info=info: archive.read(info))
            if member:
                members.append(member)
    return members


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("sources", nargs="+", help="a .zip or a folder (see above)")
    parser.add_argument("--dry-run", action="store_true", help="only list what would be copied")
    parser.add_argument("--disc1-substitute", action="store_true",
                        help="install the Ace Attorney tracks from Trilogy Disc 1 (matched by title) when no PWAA zip is given; loops may be offset")
    args = parser.parse_args(argv)

    members: list[Member] = []
    for item in args.sources:
        source = Path(item)
        if not source.exists():
            print(f"Source not found: {source}")
            return 2
        found = scan(source)
        print(f"{source}: {len(found)} MP3")
        members += found
    covered = {m.disc for m in members}
    if not members:
        print("No 'NN. Title.mp3' files found in the given sources.")
        return 2

    tracks = json.loads((MUSIC / "soundtrack.json").read_text(encoding="utf-8"))["tracks"]
    original_dir = (MUSIC / "original").resolve()
    installed = missing = skipped = 0
    for track_id, entry in tracks.items():
        src = entry.get("src")
        if not src:
            continue
        # DS derivatives have an audited, separate installer. A Trilogy import must
        # never overwrite them (in particular, MP3 bytes cannot replace a FLAC).
        if entry.get("audioProvenance", "").startswith("original-ds-"):
            skipped += 1
            continue
        disc = entry.get("disc")
        if disc is None:  # Ace Attorney (disc 1) tracks: PWAA zip numbering, or Trilogy Disc 1 by title
            matches = [m for m in members if m.disc == LEGACY and m.number == entry["number"]]
            if not matches and args.disc1_substitute:
                matches = [m for m in members if m.disc == 1 and m.key == normalise(entry["title"])]
            needs = LEGACY in covered or (args.disc1_substitute and 1 in covered)
        else:
            matches = [m for m in members if m.disc == disc and m.number == entry["number"]]
            needs = disc in covered
        if not needs:
            skipped += 1
            continue
        if not matches:
            print(f"MISSING  {track_id} ({'disc ' + str(disc) + ' ' if disc else ''}track {entry['number']:02d})")
            missing += 1
            continue
        data = matches[0].read()
        # Name variants of one track (":" vs "-") are byte-identical; anything else is ambiguous.
        for other in matches[1:]:
            if other.read() != data:
                print(f"{track_id}: different files share this number ({other.label}); check the sources.")
                return 1
        target = (MUSIC / src).resolve()
        if original_dir not in target.parents:
            print(f"{track_id}: refusing to write outside music/original ({src})")
            return 1
        if not args.dry_run:
            target.parent.mkdir(parents=True, exist_ok=True)
            if not (target.exists() and target.stat().st_size == len(data) and target.read_bytes() == data):
                target.write_bytes(data)
        print(f"{'would copy' if args.dry_run else 'installed'}  {matches[0].label} -> {target.relative_to(ROOT)}")
        installed += 1
    print(f"{installed} tracks {'matched' if args.dry_run else 'installed'}, {missing} missing, "
          f"{skipped} skipped (their source was not given).")
    print("Check with: cd frontend && npm run validate:assets")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
