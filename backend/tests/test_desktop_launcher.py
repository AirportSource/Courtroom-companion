import json
import logging
import os
import sys
import threading

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.desktop import launcher
from app.desktop.instance import (
    SingleInstance,
    create_named_mutex,
    mutex_name_for,
    pid_is_alive,
    read_instance,
)
from app.desktop.lifecycle import HEARTBEAT_INTERVAL_MS, HeartbeatMonitor, create_desktop_router, run_watchdog
from app.desktop.logging_setup import REDACTED, RedactingFormatter, RedactionFilter, configure_logging, redact


# --- localhost-only / URL ---------------------------------------------------------------------

def test_socket_binds_loopback_only_on_ephemeral_port():
    sock = launcher.bind_loopback_socket()
    try:
        host, port = sock.getsockname()
        assert host == "127.0.0.1" and launcher.HOST == "127.0.0.1"
        assert port > 0
    finally:
        sock.close()


def test_app_url_uses_loopback_and_port():
    assert launcher.app_url(5123) == "http://127.0.0.1:5123/"


# --- instance file / single instance ----------------------------------------------------------

def make_instance(tmp_path, *, already=False, alive=True, healthy=True):
    closed = []
    inst = SingleInstance(
        tmp_path,
        mutex_factory=lambda name: (object(), already),
        pid_alive=lambda pid: alive,
        health=lambda port: healthy,
        closer=closed.append,
    )
    return inst, closed


def test_instance_file_roundtrip_and_release(tmp_path):
    inst, closed = make_instance(tmp_path)
    assert inst.acquire() is True
    inst.write(4321)
    info = read_instance(inst.path)
    assert (info.port, info.pid) == (4321, os.getpid())
    inst.release()
    assert not inst.path.exists() and len(closed) == 1


def test_second_launch_does_not_own_and_closes_handle(tmp_path):
    inst, closed = make_instance(tmp_path, already=True)
    assert inst.acquire() is False and len(closed) == 1


def test_live_instance_detected_and_stale_ignored(tmp_path):
    (tmp_path / "instance.json").write_text(json.dumps({"port": 5000, "pid": os.getpid() + 1}))
    assert make_instance(tmp_path)[0].live_instance().url == "http://127.0.0.1:5000/"
    assert make_instance(tmp_path, alive=False)[0].live_instance() is None  # dead pid
    assert make_instance(tmp_path, healthy=False)[0].live_instance() is None  # no health


@pytest.mark.parametrize("content", ["", "not json", "{}", '{"port": 0, "pid": 5}', '{"port": 70000, "pid": 5}',
                                     '{"port": "x", "pid": 5}'])
def test_corrupt_instance_file_is_ignored(tmp_path, content):
    path = tmp_path / "instance.json"
    path.write_text(content)
    assert read_instance(path) is None
    assert read_instance(tmp_path / "missing.json") is None


def test_release_keeps_other_processes_file(tmp_path):
    inst, _ = make_instance(tmp_path)
    inst.acquire()
    (tmp_path / "instance.json").write_text(json.dumps({"port": 1, "pid": os.getpid() + 7}))
    inst.release()
    assert inst.path.exists()


def test_wait_for_instance_polls_until_deadline(tmp_path):
    inst, _ = make_instance(tmp_path)
    now = [0.0]
    sleeps = []

    def sleep(seconds):
        sleeps.append(seconds)
        now[0] += seconds
        if now[0] >= 1.0:
            (tmp_path / "instance.json").write_text(json.dumps({"port": 6000, "pid": os.getpid() + 1}))

    found = inst.wait_for_instance(5.0, interval=0.5, sleep=sleep, clock=lambda: now[0])
    assert found.port == 6000 and len(sleeps) == 2
    assert make_instance(tmp_path / "none")[0].wait_for_instance(1.0, 0.5, sleep=lambda s: now.__setitem__(0, now[0] + s),
                                                                  clock=lambda: now[0]) is None


def test_mutex_name_is_per_directory(tmp_path):
    assert mutex_name_for(tmp_path / "a") != mutex_name_for(tmp_path / "b")
    assert mutex_name_for(tmp_path / "a") == mutex_name_for(tmp_path / "a")


@pytest.mark.skipif(sys.platform != "win32", reason="Win32 smoke check")
def test_real_mutex_smoke():
    name = f"Local\\CourtroomCompanionTest-{os.getpid()}"
    first, existed = create_named_mutex(name)
    second, existed_again = create_named_mutex(name)
    try:
        assert existed is False and existed_again is True
        assert pid_is_alive(os.getpid()) and not pid_is_alive(0)
    finally:
        from app.desktop.instance import close_handle
        close_handle(second)
        close_handle(first)


# --- heartbeat watchdog -----------------------------------------------------------------------

class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def test_monitor_never_connected_grace():
    clock = FakeClock()
    monitor = HeartbeatMonitor(clock=clock, grace_after_connect=120, grace_never_connected=600)
    clock.now = 599
    assert not monitor.expired()
    clock.now = 601
    assert monitor.expired()


def test_monitor_expires_after_silence_and_beats_extend():
    clock = FakeClock()
    monitor = HeartbeatMonitor(clock=clock, grace_after_connect=120, grace_never_connected=600)
    clock.now = 50
    monitor.beat()
    clock.now = 160
    assert not monitor.expired()  # 110s of silence, within grace
    monitor.beat()
    clock.now = 270
    assert not monitor.expired()
    clock.now = 281
    assert monitor.expired()


def test_forgive_restarts_window():
    clock = FakeClock()
    monitor = HeartbeatMonitor(clock=clock, grace_after_connect=120, grace_never_connected=600)
    monitor.beat()
    clock.now = 1000
    monitor.forgive()
    assert not monitor.expired()


def test_watchdog_stops_once_when_expired():
    clock = FakeClock()
    monitor = HeartbeatMonitor(clock=clock, grace_after_connect=10, grace_never_connected=10)
    stops = []

    class FakeEvent(threading.Event):
        def wait(self, timeout=None):
            clock.now += 4
            return False

    run_watchdog(monitor, lambda: stops.append(1), FakeEvent(), poll_s=4, clock=clock)
    assert stops == [1]


def test_watchdog_treats_large_tick_gap_as_resume():
    clock = FakeClock()
    monitor = HeartbeatMonitor(clock=clock, grace_after_connect=10, grace_never_connected=10)
    monitor.beat()
    ticks = iter([1000, 1002, 1100])  # first jump simulates sleep
    stops = []

    class FakeEvent(threading.Event):
        def wait(self, timeout=None):
            try:
                clock.now = next(ticks)
            except StopIteration:
                return True
            return False

    run_watchdog(monitor, lambda: stops.append(1), FakeEvent(), poll_s=2, clock=clock)
    # tick at 1000 forgives the gap, 1002 is fresh, 1100 is a second large gap that forgives again
    assert stops == []


def test_watchdog_exits_when_done_set():
    done = threading.Event()
    done.set()
    run_watchdog(HeartbeatMonitor(), lambda: pytest.fail("stopped"), done, poll_s=0.01)


# --- routes -----------------------------------------------------------------------------------

def desktop_client(monitor, client=("127.0.0.1", 50000)):
    app = FastAPI()
    app.include_router(create_desktop_router(monitor))
    return TestClient(app, base_url="http://127.0.0.1:8000", client=client)


def test_info_and_heartbeat_routes():
    monitor = HeartbeatMonitor()
    client = desktop_client(monitor)
    info = client.get("/api/app/info")
    assert info.status_code == 200
    assert info.json()["desktop"] is True and info.json()["heartbeatIntervalMs"] == HEARTBEAT_INTERVAL_MS
    assert info.headers["cache-control"] == "no-store"
    assert not monitor.connected
    beat = client.post("/api/app/heartbeat")
    assert beat.status_code == 204 and beat.headers["cache-control"] == "no-store"
    assert monitor.connected


def test_routes_reject_remote_and_cross_site():
    monitor = HeartbeatMonitor()
    assert desktop_client(monitor, client=("203.0.113.9", 4000)).post("/api/app/heartbeat").status_code == 403
    cross = desktop_client(monitor).post("/api/app/heartbeat", headers={"Origin": "http://evil.example"})
    assert cross.status_code == 403
    assert not monitor.connected


# --- logging ----------------------------------------------------------------------------------

@pytest.mark.parametrize("text,secret", [
    ("Authorization: Bearer abcdef123456789", "abcdef123456789"),
    ("headers={'x-api-key': 'topsecretvalue'}", "topsecretvalue"),
    ("api_key=sk-live-1234567890", "sk-live-1234567890"),
    ('{"apiKey": "hunter2hunter2"}', "hunter2hunter2"),
    ("token: ghp_abcdefghijk", "ghp_abcdefghijk"),
    ("key was sk-abcdefghijklmnop here", "sk-abcdefghijklmnop"),
])
def test_redact_removes_secrets(text, secret):
    cleaned = redact(text)
    assert secret not in cleaned and REDACTED in cleaned


def test_redaction_filter_and_traceback(tmp_path):
    logger = logging.getLogger("redaction-test")
    logger.propagate = False
    records = []

    class Capture(logging.Handler):
        def emit(self, record):
            records.append(RedactingFormatter("%(message)s").format(record))

    handler = Capture()
    handler.addFilter(RedactionFilter())
    logger.addHandler(handler)
    try:
        raise ValueError("Authorization: Bearer supersecrettoken123")
    except ValueError:
        logger.error("call with api_key=%s failed", "sk-should-not-appear", exc_info=True)
    assert "sk-should-not-appear" not in records[0] and "supersecrettoken123" not in records[0]


def test_configure_logging_writes_rotating_file_and_survives_none_streams(tmp_path, monkeypatch):
    root = logging.getLogger()
    saved = list(root.handlers), root.level
    monkeypatch.setattr(sys, "stdout", None)
    monkeypatch.setattr(sys, "stderr", None)
    try:
        path = configure_logging(tmp_path / "logs")
        logging.getLogger("x").info("hello Authorization: Bearer abcdefgh12345678")
        for handler in root.handlers:
            handler.flush()
        text = path.read_text(encoding="utf-8")
        assert "hello" in text and "abcdefgh12345678" not in text
        assert sys.stdout is not None and sys.stderr is not None
    finally:
        for handler in list(root.handlers):
            handler.close()
            root.removeHandler(handler)
        for handler in saved[0]:
            root.addHandler(handler)
        root.setLevel(saved[1])


# --- one-file parent watch --------------------------------------------------------------------

def test_is_onefile_detection(monkeypatch, tmp_path):
    from app.desktop import parentwatch

    monkeypatch.setattr(sys, "executable", str(tmp_path / "app" / "CourtroomCompanion.exe"))
    monkeypatch.setattr(sys, "frozen", False, raising=False)
    assert parentwatch.is_onefile() is False  # dev
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path / "app" / "_internal"), raising=False)
    assert parentwatch.is_onefile() is False  # onedir
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path / "temp" / "_MEI123"), raising=False)
    assert parentwatch.is_onefile() is True


def test_parent_exit_triggers_stop():
    from app.desktop.parentwatch import watch_parent

    calls, closed, stops = [], [], []

    def waiter(handle, ms):
        calls.append(ms)
        return len(calls) == 3

    assert watch_parent(lambda: stops.append(1), threading.Event(), opener=lambda: "h", waiter=waiter,
                        closer=closed.append, poll_ms=10) is True
    assert stops == [1] and closed == ["h"] and len(calls) == 3


def test_parent_watch_disabled_without_matching_parent_and_stops_on_done():
    from app.desktop.parentwatch import watch_parent

    assert watch_parent(lambda: pytest.fail("stop"), threading.Event(), opener=lambda: None,
                        waiter=lambda h, ms: pytest.fail("wait")) is False
    done = threading.Event()
    done.set()
    closed = []
    assert watch_parent(lambda: pytest.fail("stop"), done, opener=lambda: "h", waiter=lambda h, ms: False,
                        closer=closed.append) is False
    assert closed == ["h"]


@pytest.mark.skipif(sys.platform != "win32", reason="Win32 smoke check")
def test_open_parent_handle_rejects_unrelated_parent():
    from app.desktop.parentwatch import open_parent_handle

    assert open_parent_handle(executable="C:/definitely/not/the/parent.exe") is None


# --- stable preferred port --------------------------------------------------------------------

def test_first_launch_stores_preference(tmp_path):
    sock = launcher.bind_loopback_socket(tmp_path)
    try:
        assert sock.getsockname()[0] == "127.0.0.1"
        assert launcher.load_preferred_port(tmp_path) == sock.getsockname()[1]
    finally:
        sock.close()


def test_preferred_port_is_reused(tmp_path):
    first = launcher.bind_loopback_socket(tmp_path)
    port = first.getsockname()[1]
    first.close()
    second = launcher.bind_loopback_socket(tmp_path)
    try:
        assert second.getsockname() == ("127.0.0.1", port)
    finally:
        second.close()


def test_busy_preferred_port_falls_back_without_overwriting(tmp_path, caplog):
    holder = launcher.bind_loopback_socket(tmp_path)
    holder.listen()
    busy = holder.getsockname()[1]
    try:
        with caplog.at_level(logging.WARNING, logger="courtroom.desktop"):
            fallback = launcher.bind_loopback_socket(tmp_path)
        try:
            assert fallback.getsockname()[1] != busy and fallback.getsockname()[0] == "127.0.0.1"
            assert launcher.load_preferred_port(tmp_path) == busy
            assert "different browser origin" in caplog.text
        finally:
            fallback.close()
    finally:
        holder.close()


@pytest.mark.parametrize("content", ["", "garbage", "{}", '{"port": 80}', '{"port": 70000}', '{"port": "5000"}',
                                     '{"port": true}', '{"port": 1023}', "[]"])
def test_corrupt_preference_is_ignored_and_replaced(tmp_path, content):
    (tmp_path / "preferred-port.json").write_text(content)
    assert launcher.load_preferred_port(tmp_path) is None
    sock = launcher.bind_loopback_socket(tmp_path)
    try:
        assert launcher.load_preferred_port(tmp_path) == sock.getsockname()[1]
    finally:
        sock.close()
