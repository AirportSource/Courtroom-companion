#!/usr/bin/env python3
"""Install the original soundtrack MP3s from the OST zip (D-044; the MP3s are not stored in Git).

Download the "VBR MP3" ZIP (38 files, about 84 MB) from
https://archive.org/details/pwaa-original-soundtrack, then run from the repository root:

    python scripts/install_ost.py path/to/pwaa-original-soundtrack.zip

Each runtime track of frontend/public/assets/music/soundtrack.json is matched by its OST number
(the "NN." prefix in the zip) and copied unchanged to frontend/public/assets/music/original/.
Standard library only.
"""

import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MUSIC = ROOT / "frontend" / "public" / "assets" / "music"


def main(zip_path: str) -> int:
    tracks = json.loads((MUSIC / "soundtrack.json").read_text(encoding="utf-8"))["tracks"]
    wanted = {t["number"]: t["src"] for t in tracks.values() if t.get("src")}
    found: dict[int, bytes] = {}
    with zipfile.ZipFile(zip_path) as archive:
        for info in archive.infolist():
            name = Path(info.filename).name
            match = re.match(r"(\d+)\.", name)
            if not match or not name.lower().endswith(".mp3"):
                continue
            number = int(match.group(1))
            data = archive.read(info)
            # Name variants of one track (":" vs "-") are byte-identical; anything else is ambiguous.
            if number in found and found[number] != data:
                print(f"Track {number:02d}: different files share this number; check the zip.")
                return 1
            found[number] = data
    missing = []
    for number, src in sorted(wanted.items()):
        if number not in found:
            missing.append(f"{number:02d} ({src})")
            continue
        target = MUSIC / src
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(found[number])
        print(f"{number:02d} -> {target.relative_to(ROOT)}")
    if missing:
        print("Missing from the zip: " + ", ".join(missing))
        return 1
    print(f"Installed {len(wanted)} tracks. Check with: cd frontend && npm run validate:assets")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
