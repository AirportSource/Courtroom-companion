"""Build the Windows desktop executable.

Run with the backend virtualenv's Python from anywhere:

    backend\\.venv\\Scripts\\python.exe scripts\\build_windows.py --mode release --onefile
    backend\\.venv\\Scripts\\python.exe scripts\\build_windows.py --mode debug --onedir --smoke

Outputs (git-ignored):
    dist/CourtroomCompanion.exe            release, one-file, windowed
    dist/CourtroomCompanion-debug/         debug, one-dir, console
The original soundtrack (frontend/public/assets/music/original + soundtrack.json) is copyrighted
and excluded unless --with-original-soundtrack is given (personal builds only).
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
FRONTEND = REPO / "frontend"
SPEC = REPO / "packaging" / "CourtroomCompanion.spec"
DIST = REPO / "dist"
WORK = REPO / "build" / "pyinstaller"
STAGE = REPO / "build" / "frontend_stage"
# Paths (relative to the dist root) that must never ship by default.
EXCLUDED_BY_DEFAULT = ("assets/music/original", "assets/music/soundtrack.json")


def run(command: list[str], **kwargs) -> None:
    print("+", " ".join(command), flush=True)
    result = subprocess.run(command, **kwargs)
    if result.returncode != 0:
        sys.exit(f"BUILD FAILED: command exited with {result.returncode}: {' '.join(command)}")


def running_processes(exe: Path) -> list[int]:
    """PIDs of CourtroomCompanion.exe processes whose image is exactly `exe` (bootloader + child)."""
    script = ("Get-CimInstance Win32_Process -Filter \"Name='%s'\" | "
              "Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress" % exe.name)
    out = subprocess.run(["powershell", "-NoProfile", "-Command", script], capture_output=True, text=True).stdout.strip()
    if not out:
        return []
    rows = json.loads(out)
    rows = [rows] if isinstance(rows, dict) else rows
    target = os.path.normcase(str(exe.resolve()))
    return [r["ProcessId"] for r in rows
            if r.get("ExecutablePath") and os.path.normcase(os.path.abspath(r["ExecutablePath"])) == target]


def kill_tree(pid: int) -> None:
    subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)


def ensure_output_unlocked(exe: Path) -> None:
    """Fail early and loudly if a running instance (or anything else) holds the output exe."""
    if not exe.exists():
        return
    pids = running_processes(exe)
    if pids:
        sys.exit(f"BUILD ABORTED: {exe} is running (PIDs {pids}). Stop it first "
                 f"(taskkill /PID <pid> /T /F) and rebuild.")
    try:
        with open(exe, "ab"):
            pass
    except OSError as error:
        sys.exit(f"BUILD ABORTED: {exe} is locked ({error}). Close whatever holds it and rebuild.")


def check_prerequisites() -> str:
    npm = shutil.which("npm")
    if not npm or not shutil.which("node"):
        sys.exit("node and npm must be installed to build the frontend.")
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        sys.exit("PyInstaller is missing: pip install -r backend/requirements-build.txt")
    if not (FRONTEND / "node_modules").is_dir():
        run([npm, "ci"], cwd=FRONTEND)
    return npm


def stage_frontend(npm: str, with_soundtrack: bool) -> Path:
    run([npm, "run", "build"], cwd=FRONTEND)
    dist = FRONTEND / "dist"
    if not (dist / "index.html").is_file():
        sys.exit("frontend/dist/index.html missing after build.")
    if STAGE.exists():
        shutil.rmtree(STAGE)
    shutil.copytree(dist, STAGE)
    if not with_soundtrack:
        for relative in EXCLUDED_BY_DEFAULT:
            target = STAGE / relative
            if target.is_dir():
                shutil.rmtree(target)
            elif target.exists():
                target.unlink()
        print("Excluded the copyrighted original soundtrack from the bundle.")
    else:
        print("WARNING: bundling the original soundtrack (personal build; do not redistribute).")
    return STAGE


def tree_size(path: Path) -> int:
    if path.is_file():
        return path.stat().st_size
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())


def run_pyinstaller(mode: str, onefile: bool, stage: Path) -> Path:
    env = dict(os.environ, COURTROOM_BUILD_MODE=mode, COURTROOM_BUILD_ONEFILE="1" if onefile else "0",
               COURTROOM_FRONTEND_STAGE=str(stage))
    work = WORK / f"{mode}-{'onefile' if onefile else 'onedir'}"
    expected = (DIST / ("CourtroomCompanion-debug.exe" if mode == "debug" else "CourtroomCompanion.exe")) if onefile         else DIST / ("CourtroomCompanion-debug" if mode == "debug" else "CourtroomCompanion") / "CourtroomCompanion.exe"
    ensure_output_unlocked(expected)
    run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--distpath", str(DIST),
         "--workpath", str(work), str(SPEC)], env=env, cwd=REPO)
    if onefile:
        return DIST / ("CourtroomCompanion-debug.exe" if mode == "debug" else "CourtroomCompanion.exe")
    folder = DIST / ("CourtroomCompanion-debug" if mode == "debug" else "CourtroomCompanion")
    return folder / "CourtroomCompanion.exe"


def fetch(url: str, timeout: float = 3.0) -> tuple[int, bytes]:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(url, timeout=timeout) as response:
        return response.status, response.read()


def smoke(exe: Path) -> None:
    """Launch the build against a throwaway data dir, check it serves, then stop it."""
    data = Path(tempfile.mkdtemp(prefix="cc-smoke-"))
    env = dict(os.environ, COURTROOM_CONFIG_DIR=str(data), COURTROOM_NO_BROWSER="1")
    process = subprocess.Popen([str(exe), "--no-browser"], env=env, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, cwd=data)
    try:
        instance = data / "instance" / "instance.json"
        deadline = time.monotonic() + 90
        port = None
        while time.monotonic() < deadline and process.poll() is None:
            if instance.is_file():
                try:
                    port = json.loads(instance.read_text())["port"]
                    break
                except (ValueError, KeyError):
                    pass
            time.sleep(0.5)
        if port is None:
            sys.exit(f"Smoke test failed: no instance file (exit code {process.poll()}). Logs: {data / 'logs'}")
        base = f"http://127.0.0.1:{port}"
        for path, needle in (("/api/health", b'"status"'), ("/", b"<div id=\"root\""), ("/api/app/info", b'"desktop"')):
            status, body = fetch(base + path)
            if status != 200 or needle not in body:
                sys.exit(f"Smoke test failed: {path} -> {status}")
            print(f"  {path}: OK")
        print(f"Smoke test passed on port {port}.")
    finally:
        # Ending only the bootloader must be enough: the one-file child watches its parent.
        process.terminate()
        try:
            process.wait(10)
        except subprocess.TimeoutExpired:
            pass
        deadline = time.monotonic() + 15
        while running_processes(exe) and time.monotonic() < deadline:
            time.sleep(0.5)
        leftovers = running_processes(exe)
        if leftovers:
            print(f"WARNING: processes outlived the parent ({leftovers}); killing the tree.")
            for pid in leftovers:
                kill_tree(pid)
            time.sleep(1)
        shutil.rmtree(data, ignore_errors=True)
        remaining = running_processes(exe)
        if remaining:
            sys.exit(f"Smoke test FAILED: orphan processes remain: {remaining}")
        if leftovers:
            sys.exit(f"Smoke test FAILED: processes {leftovers} did not exit when the parent was terminated.")
        print("No CourtroomCompanion processes remain.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--mode", choices=("debug", "release"), default="release")
    layout = parser.add_mutually_exclusive_group()
    layout.add_argument("--onefile", dest="onefile", action="store_true", default=None)
    layout.add_argument("--onedir", dest="onefile", action="store_false")
    parser.add_argument("--with-original-soundtrack", action="store_true",
                        help="Bundle the copyrighted OST (personal builds only).")
    parser.add_argument("--smoke", action="store_true", help="Launch the result and verify it serves.")
    parser.add_argument("--skip-frontend-build", action="store_true", help="Reuse the existing frontend/dist.")
    args = parser.parse_args()
    onefile = args.onefile if args.onefile is not None else args.mode == "release"

    npm = check_prerequisites()
    if args.skip_frontend_build:
        shutil.rmtree(STAGE, ignore_errors=True)
        shutil.copytree(FRONTEND / "dist", STAGE)
        if not args.with_original_soundtrack:
            for relative in EXCLUDED_BY_DEFAULT:
                target = STAGE / relative
                shutil.rmtree(target) if target.is_dir() else target.unlink(missing_ok=True)
        stage = STAGE
    else:
        stage = stage_frontend(npm, args.with_original_soundtrack)
    exe = run_pyinstaller(args.mode, onefile, stage)
    if not exe.is_file():
        sys.exit(f"Expected output missing: {exe}")
    output = exe if onefile else exe.parent
    print(f"\nBuilt: {output}\nSize: {tree_size(output) / 1_048_576:.1f} MiB")
    if args.smoke:
        smoke(exe)


if __name__ == "__main__":
    main()
