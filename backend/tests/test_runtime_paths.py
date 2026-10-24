import sys
from pathlib import Path

import pytest

from app.runtime import paths

REPO = Path(__file__).resolve().parents[2]
ENV = ("COURTROOM_CONFIG_DIR", "COURTROOM_OUTPUTS_DIR", "COURTROOM_MUSIC_DIR", "COURTROOM_CONVERSATION_RECORD_DIR",
       "COURTROOM_LOG_DIR", "COURTROOM_ASSETS_DIR", "COURTROOM_FRONTEND_DIST")


@pytest.fixture
def clean(monkeypatch):
    for name in ENV:
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


@pytest.fixture
def frozen(clean, tmp_path):
    bundle = tmp_path / "bundle"
    local = tmp_path / "local"
    clean.setattr(sys, "frozen", True, raising=False)
    clean.setattr(sys, "_MEIPASS", str(bundle), raising=False)
    clean.setattr(sys, "platform", "win32")
    clean.setenv("LOCALAPPDATA", str(local))
    return bundle, local


def test_dev_layout_unchanged(clean):
    local = REPO / "backend" / ".local"
    assert not paths.is_frozen()
    assert paths.resource_root() == REPO
    assert paths.config_dir() / "provider-profiles.json" == local / "provider-profiles.json"
    assert paths.outputs_dir() == local / "outputs"
    assert paths.music_dir() == local / "music"
    assert paths.conversation_record_dir() == local / "conversation-record"
    assert paths.assets_dir() == REPO / "frontend" / "public" / "assets"
    assert paths.frontend_dist_dir() == REPO / "frontend" / "dist"
    assert paths.logs_dir() == local / "logs" and paths.instance_dir() == local / "instance"


def test_config_dir_env_is_base(clean, tmp_path):
    clean.setenv("COURTROOM_CONFIG_DIR", str(tmp_path))
    assert paths.config_dir() == tmp_path
    assert paths.outputs_dir() == tmp_path / "outputs"
    assert paths.music_dir() == tmp_path / "music"
    assert paths.conversation_record_dir() == tmp_path / "conversation-record"


def test_store_specific_env_wins(clean, tmp_path):
    clean.setenv("COURTROOM_CONFIG_DIR", str(tmp_path / "base"))
    for name, fn in (("COURTROOM_OUTPUTS_DIR", paths.outputs_dir), ("COURTROOM_MUSIC_DIR", paths.music_dir),
                     ("COURTROOM_CONVERSATION_RECORD_DIR", paths.conversation_record_dir),
                     ("COURTROOM_LOG_DIR", paths.logs_dir)):
        clean.setenv(name, str(tmp_path / name))
        assert fn() == tmp_path / name


def test_resource_env_overrides(clean, tmp_path):
    clean.setenv("COURTROOM_ASSETS_DIR", str(tmp_path / "a"))
    clean.setenv("COURTROOM_FRONTEND_DIST", str(tmp_path / "d"))
    assert paths.assets_dir() == tmp_path / "a"
    assert paths.frontend_dist_dir() == tmp_path / "d"


def test_env_read_at_call_time(clean, tmp_path):
    first = paths.music_dir()
    clean.setenv("COURTROOM_MUSIC_DIR", str(tmp_path))
    assert paths.music_dir() == tmp_path != first


def test_frozen_layout(frozen):
    bundle, local = frozen
    root = local / paths.APP_NAME
    assert paths.is_frozen() and paths.resource_root() == bundle
    assert paths.frontend_dist_dir() == bundle / "frontend_dist"
    assert paths.assets_dir() == bundle / "frontend_dist" / "assets"
    assert paths.data_root() == root
    assert paths.config_dir() == root / "config"
    assert paths.outputs_dir() == root / "outputs"
    assert paths.music_dir() == root / "music"
    assert paths.conversation_record_dir() == root / "conversation-record"
    assert paths.logs_dir() == root / "logs"
    assert paths.instance_dir() == root / "instance"
    assert not root.exists()  # resolution never creates directories


def test_frozen_config_env_is_base(frozen, tmp_path):
    frozen_env = tmp_path / "custom"
    sys.modules  # noqa: B018
    import os
    os.environ["COURTROOM_CONFIG_DIR"] = str(frozen_env)
    try:
        assert paths.config_dir() == frozen_env
        assert paths.outputs_dir() == frozen_env / "outputs"
    finally:
        del os.environ["COURTROOM_CONFIG_DIR"]


def test_frozen_missing_localappdata_falls_back_to_home(frozen):
    frozen_bundle, _ = frozen
    import os
    os.environ.pop("LOCALAPPDATA")
    assert paths.data_root() == Path.home() / "AppData" / "Local" / paths.APP_NAME


def test_frozen_guard_rejects_paths_inside_bundle(frozen):
    bundle, _ = frozen
    with pytest.raises(RuntimeError):
        paths.assert_writable_location(bundle / "x")
    import os
    os.environ["COURTROOM_MUSIC_DIR"] = str(bundle / "music")
    try:
        with pytest.raises(RuntimeError):
            paths.music_dir()
    finally:
        del os.environ["COURTROOM_MUSIC_DIR"]


def test_guard_inactive_in_dev(clean):
    target = REPO / "anything"
    assert paths.assert_writable_location(target) == target


def test_describe_paths_has_no_secrets(clean):
    info = paths.describe_paths()
    assert {"resource_root", "data_root", "assets", "outputs"} <= set(info)
