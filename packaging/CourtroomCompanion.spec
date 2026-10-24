# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the Courtroom Companion Windows desktop build.

Normally driven by scripts/build_windows.py. Selection comes from environment variables so the
spec stays path-independent (everything is derived from SPECPATH):

  COURTROOM_BUILD_MODE      release (default, windowed) | debug (console)
  COURTROOM_BUILD_ONEFILE   1 / 0   (default: 1 for release, 0 for debug)
  COURTROOM_FRONTEND_STAGE  directory holding the frontend build to bundle as `frontend_dist`
                            (default: <repo>/frontend/dist)
"""

import os
import re

from PyInstaller.utils.hooks import collect_submodules, copy_metadata
from PyInstaller.utils.win32.versioninfo import (
    FixedFileInfo, StringFileInfo, StringStruct, StringTable, VarFileInfo, VarStruct, VSVersionInfo,
)

REPO = os.path.abspath(os.path.join(SPECPATH, ".."))
BACKEND = os.path.join(REPO, "backend")

MODE = os.environ.get("COURTROOM_BUILD_MODE", "release").lower()
if MODE not in {"release", "debug"}:
    raise SystemExit(f"COURTROOM_BUILD_MODE must be release or debug, got {MODE!r}")
DEBUG = MODE == "debug"
ONEFILE = os.environ.get("COURTROOM_BUILD_ONEFILE", "0" if DEBUG else "1") == "1"
FRONTEND = os.environ.get("COURTROOM_FRONTEND_STAGE") or os.path.join(REPO, "frontend", "dist")
if not os.path.isfile(os.path.join(FRONTEND, "index.html")):
    raise SystemExit(f"Frontend build not found at {FRONTEND} (run npm run build).")

with open(os.path.join(BACKEND, "app", "desktop", "__init__.py"), encoding="utf-8") as handle:
    VERSION = re.search(r'APP_VERSION\s*=\s*"([^"]+)"', handle.read()).group(1)
VERSION_TUPLE = tuple((int(part) for part in VERSION.split(".")[:3])) + (0,)

version_info = VSVersionInfo(
    ffi=FixedFileInfo(filevers=VERSION_TUPLE, prodvers=VERSION_TUPLE, mask=0x3F, flags=0x0, OS=0x40004,
                      fileType=0x1, subtype=0x0, date=(0, 0)),
    kids=[
        StringFileInfo([StringTable("040904B0", [
            StringStruct("CompanyName", ""),
            StringStruct("FileDescription", "Courtroom Companion" + (" (debug)" if DEBUG else "")),
            StringStruct("FileVersion", VERSION),
            StringStruct("InternalName", "CourtroomCompanion"),
            StringStruct("OriginalFilename", "CourtroomCompanion.exe"),
            StringStruct("ProductName", "Courtroom Companion"),
            StringStruct("ProductVersion", VERSION),
        ])]),
        VarFileInfo([VarStruct("Translation", [0x0409, 1200])]),
    ],
)

hiddenimports = (
    collect_submodules("uvicorn")  # loops, protocols (h11), lifespan are imported by name at runtime
    + collect_submodules("keyring.backends")  # discovered dynamically; WinVaultKeyring must be present
    + collect_submodules("win32ctypes")  # pywin32-ctypes: the Windows keyring backend's credential API
    + collect_submodules("app")
    + ["h11"]
)

datas = [(FRONTEND, "frontend_dist")] + copy_metadata("keyring")

excludes = [
    "pytest", "_pytest", "pluggy", "iniconfig", "tkinter", "turtle", "idlelib", "lib2to3",
    "pydoc_data", "test", "IPython", "matplotlib", "numpy", "pandas", "scipy",
    "websockets", "httptools", "uvloop", "watchfiles", "yaml", "dotenv",
]

a = Analysis(
    [os.path.join(BACKEND, "desktop_main.py")],
    pathex=[BACKEND],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
)
pyz = PYZ(a.pure)

if ONEFILE:
    exe = EXE(
        pyz, a.scripts, a.binaries, a.datas, [],
        name="CourtroomCompanion" + ("-debug" if DEBUG else ""),
        debug=False, strip=False, upx=False, console=DEBUG,
        version=version_info, runtime_tmpdir=None,
    )
else:
    exe = EXE(
        pyz, a.scripts, [], exclude_binaries=True,
        name="CourtroomCompanion",
        debug=False, strip=False, upx=False, console=DEBUG,
        version=version_info,
    )
    coll = COLLECT(
        exe, a.binaries, a.datas,
        strip=False, upx=False,
        name="CourtroomCompanion-debug" if DEBUG else "CourtroomCompanion",
    )
