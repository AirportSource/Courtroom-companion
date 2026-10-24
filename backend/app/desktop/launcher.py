"""Desktop entry: bind loopback, serve API + built frontend in-process, open the browser, clean up."""

from __future__ import annotations

import argparse
import json
import logging
import os
import socket
import sys
import threading
import time
import traceback
import webbrowser
from pathlib import Path

from . import APP_NAME, APP_VERSION
from .instance import SingleInstance
from .lifecycle import HeartbeatMonitor, create_desktop_router, run_watchdog
from .logging_setup import configure_logging, redact
from .parentwatch import is_onefile, watch_parent

HOST = "127.0.0.1"
SECOND_LAUNCH_WAIT_S = 20.0
START_TIMEOUT_S = 60.0

log = logging.getLogger("courtroom.desktop")


PREFERRED_PORT_FILE = "preferred-port.json"
MIN_PREFERRED_PORT = 1024


def load_preferred_port(directory: Path) -> int | None:
    """The remembered port, or None when missing/corrupt/out of range."""
    try:
        port = json.loads((directory / PREFERRED_PORT_FILE).read_text(encoding="utf-8"))["port"]
    except (OSError, ValueError, KeyError, TypeError):
        return None
    if isinstance(port, bool) or not isinstance(port, int) or not MIN_PREFERRED_PORT <= port <= 65535:
        return None
    return port


def save_preferred_port(directory: Path, port: int) -> None:
    try:
        directory.mkdir(parents=True, exist_ok=True)
        tmp = directory / (PREFERRED_PORT_FILE + ".tmp")
        tmp.write_text(json.dumps({"port": port}), encoding="utf-8")
        os.replace(tmp, directory / PREFERRED_PORT_FILE)
    except OSError:
        log.warning("Could not save the preferred port; settings may reset on restart.")


def _bind(port: int) -> socket.socket:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind((HOST, port))  # no SO_REUSEADDR: on Windows it would allow port hijacking
    except OSError:
        sock.close()
        raise
    return sock


def bind_loopback_socket(preferred_dir: Path | None = None) -> socket.socket:
    """Bind 127.0.0.1 only; the same socket is handed to uvicorn (no race).

    Browser settings live in localStorage, which is per origin (port included), so the port is
    kept stable across launches: try the remembered one, else fall back to an ephemeral port
    without overwriting the preference.
    """
    if preferred_dir is None:
        return _bind(0)
    preferred = load_preferred_port(preferred_dir)
    if preferred is not None:
        try:
            return _bind(preferred)
        except OSError as error:
            sock = _bind(0)
            log.warning("Preferred port %s is unavailable (%s); using port %s. This session has a different "
                        "browser origin, so saved settings will appear reset.", preferred, error.__class__.__name__,
                        sock.getsockname()[1])
            return sock
    sock = _bind(0)
    save_preferred_port(preferred_dir, sock.getsockname()[1])
    return sock


def app_url(port: int) -> str:
    return f"http://{HOST}:{port}/"


def has_console() -> bool:
    if sys.platform != "win32":
        return sys.__stderr__ is not None
    import ctypes

    return bool(ctypes.WinDLL("kernel32").GetConsoleWindow())


def show_error(message: str, console: bool) -> None:
    if console:
        print(message, file=sys.stderr)
        return
    if sys.platform == "win32":
        try:
            import ctypes

            ctypes.WinDLL("user32").MessageBoxW(None, message, APP_NAME, 0x10)  # MB_ICONERROR
        except Exception:
            pass


def open_browser(url: str, enabled: bool) -> None:
    if not enabled:
        log.info("Browser launch disabled; open %s manually.", url)
        return
    try:
        opened = webbrowser.open(url)
        log.info("Asked the default browser to open %s (accepted: %s).", url, opened)
    except Exception:
        log.exception("Could not open the default browser; open %s manually.", url)


def log_credential_backend() -> None:
    try:
        from ..configuration.credentials import KeyringCredentialStore

        log.info("Credential backend: %s", KeyringCredentialStore().backend_name)
    except Exception as error:
        log.warning("Credential backend unavailable: %s", type(error).__name__)


def build_app():
    from ..main import create_app
    from ..web.frontend import mount_frontend
    from ..runtime.paths import frontend_dist_dir

    monitor = HeartbeatMonitor()
    app = create_app()
    app.include_router(create_desktop_router(monitor))
    mount_frontend(app, frontend_dist_dir())  # after every router; raises FrontendMissingError
    return app, monitor


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="CourtroomCompanion", add_help=True)
    parser.add_argument("--no-browser", action="store_true", help="Do not open the default browser.")
    return parser.parse_args(argv)


def run(argv: list[str] | None = None) -> int:
    import uvicorn

    from ..runtime.paths import describe_paths, instance_dir, logs_dir

    args = parse_args(argv)
    console = has_console()
    browser = not (args.no_browser or os.environ.get("COURTROOM_NO_BROWSER"))
    log_path = configure_logging(logs_dir(), console=console)
    log.info("%s %s starting (pid %s)", APP_NAME, APP_VERSION, os.getpid())
    log.info("Paths: %s", describe_paths())

    instance = SingleInstance(instance_dir())
    sock: socket.socket | None = None
    try:
        if not instance.acquire():
            existing = instance.wait_for_instance(SECOND_LAUNCH_WAIT_S)
            if existing is None:
                raise RuntimeError("Another Courtroom Companion instance holds the lock but did not respond.")
            log.info("Already running on port %s; opening it.", existing.port)
            open_browser(existing.url, browser)
            return 0
        existing = instance.live_instance()
        if existing is not None:
            log.info("Already running on port %s; opening it.", existing.port)
            open_browser(existing.url, browser)
            return 0

        app, monitor = build_app()
        sock = bind_loopback_socket(instance_dir())
        port = sock.getsockname()[1]
        config = uvicorn.Config(app, host=HOST, port=port, log_config=None, access_log=False,
                                loop="asyncio", http="h11", ws="none", lifespan="on")
        server = uvicorn.Server(config)
        done = threading.Event()

        def after_start() -> None:
            deadline = time.monotonic() + START_TIMEOUT_S
            while not server.started and not done.is_set():
                if time.monotonic() > deadline:
                    log.error("Server did not report started within %ss.", START_TIMEOUT_S)
                    server.should_exit = True
                    return
                time.sleep(0.05)
            if done.is_set():
                return
            instance.write(port)
            log.info("Serving on %s", app_url(port))
            log_credential_backend()
            open_browser(app_url(port), browser)

        def stop() -> None:
            server.should_exit = True

        threads = [
            threading.Thread(target=after_start, name="cc-start", daemon=True),
            threading.Thread(target=run_watchdog, args=(monitor, stop, done), name="cc-watchdog", daemon=True),
        ]
        if is_onefile():
            threads.append(threading.Thread(target=watch_parent, args=(stop, done), name="cc-parent", daemon=True))
        for thread in threads:
            thread.start()
        try:
            server.run(sockets=[sock])
        except KeyboardInterrupt:
            log.info("Interrupted; shutting down.")
        finally:
            done.set()
        if not server.started:
            raise RuntimeError("The local server failed to start.")
        log.info("Shut down cleanly.")
        return 0
    except BaseException as error:
        if isinstance(error, SystemExit) and error.code in (0, None):
            raise
        log.error("Startup failed: %s\n%s", type(error).__name__, redact(traceback.format_exc()))
        show_error(f"{APP_NAME} could not start.\n\n{type(error).__name__}: {redact(str(error))}\n\nLog: {log_path}", console)
        return 1
    finally:
        if sock is not None:
            try:
                sock.close()
            except OSError:
                pass
        instance.release()
        logging.shutdown()


def main() -> None:
    sys.exit(run())
