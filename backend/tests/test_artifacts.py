"""Small untrusted text is persisted, never executed; failures never publish ready files."""

import ast
import hashlib
import json
from pathlib import Path
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from app.artifacts.contracts import CreateTextArtifact, MAX_ARTIFACT_BYTES, display_filename, turn_schema
from app.artifacts.parsing import parse_artifact_turn
from app.artifacts.store import ArtifactConflict, ArtifactError, ArtifactLimitError, ArtifactNotFound, ArtifactStore
from app.characters.prompt import reply_schema


def action(filename="script.py", content='print("Hello")\n', format="py", **extra):
    return CreateTextArtifact(type="create_text_artifact", filename=filename, format=format, content=content, **extra)


def key(value):
    return hashlib.sha256(str(value).encode()).hexdigest()


def create(store, instruction=None, request="one"):
    return store.create(instruction or action(), key(request), key("message" + request))


@pytest.mark.parametrize("raw,expected", [
    ("../../evil.py", "evil.py"), (r"..\..\evil.py", "evil.py"),
    (r"C:\Windows\evil.py", "evil.py"), ("hello/../../x.py", "x.py"),
    ("CON.py", "_CON.py"), ("aux.log.py", "_aux.log.py"),
    ("こんにちは.py", "こんにちは.py"), (" test.PY ", "test.py"),
])
def test_hostile_display_names_never_address_paths(raw, expected, tmp_path):
    store = ArtifactStore(tmp_path / "outputs")
    artifact = create(store, action(filename=raw))
    assert artifact["displayName"] == expected
    assert len(artifact["id"]) == 32
    assert list(store.files_dir.iterdir())[0].name == artifact["id"] + ".text"
    assert store.read(artifact["id"]) == 'print("Hello")\n'
    assert not (tmp_path / "evil.py").exists()


def test_absolute_unix_name_long_unicode_and_extension_validation():
    assert display_filename("/etc/passwd", "txt") == "passwd.txt"
    name = display_filename("名" * 400 + ".md", "md")
    assert len(name.encode("utf-8")) <= 164
    for value in ["", "..", "hello/../../", "<>", "foo.exe", "foo.py.exe"]:
        with pytest.raises(ValueError):
            display_filename(value, "txt")


@pytest.mark.parametrize("overrides", [
    {"format": "exe"}, {"content": "  "}, {"content": "\x00"},
    {"content": "x" * (MAX_ARTIFACT_BYTES + 1)}, {"content": "あ" * 22000},
    {"content": "\ud800"}, {"path": "../outside.py"}, {"execute": True},
    {"command": "python"}, {"cwd": "/"}, {"interpreter": "python"},
    {"shell": "cmd"}, {"permissions": "777"}, {"content": 42},
])
def test_narrow_contract_rejects_unsafe_or_invalid_data(overrides):
    data = {"type": "create_text_artifact", "filename": "a.py", "format": "py", "content": "ok"}
    with pytest.raises(ValidationError):
        CreateTextArtifact.model_validate({**data, **overrides})


def test_persistence_duplicates_receipts_and_deleted_retry(tmp_path):
    store = ArtifactStore(tmp_path)
    first = create(store)
    same = create(store)
    second = create(store, request="two")
    third = create(store, request="three")
    assert same == first
    assert [r["displayName"] for r in [first, second, third]] == ["script.py", "script-2.py", "script-3.py"]
    reloaded = ArtifactStore(tmp_path)
    assert len(reloaded.list()) == 3
    assert reloaded.read(first["id"]) == 'print("Hello")\n'
    assert create(reloaded) == first
    with pytest.raises(ArtifactConflict):
        reloaded.create(action(), key("one"), key("different message"))
    reloaded.delete(first["id"])
    with pytest.raises(ArtifactConflict):
        create(reloaded)
    with pytest.raises(ArtifactNotFound):
        reloaded.get(first["id"])


def test_missing_changed_orphan_and_interrupted_files_are_not_ready(tmp_path):
    store = ArtifactStore(tmp_path)
    artifact = create(store)
    backing = store.files_dir / (artifact["id"] + ".text")
    backing.write_text("changed", encoding="utf-8")
    assert store.get(artifact["id"])["status"] == "missing"
    backing.unlink()
    assert store.list()[0]["contentPreview"] == ""
    with pytest.raises(ArtifactNotFound):
        store.read(artifact["id"])
    (store.files_dir / ("b" * 32 + ".text")).write_text("orphan")
    (store.files_dir / ".artifact-interrupted").write_text("partial")
    assert len(ArtifactStore(tmp_path).list()) == 1
    store.delete(artifact["id"])
    assert store.list() == []


def test_corrupt_metadata_is_preserved_and_not_overwritten(tmp_path):
    path = tmp_path / "artifacts.json"
    path.write_text("{corrupt", encoding="utf-8")
    store = ArtifactStore(tmp_path)
    for operation in [store.list, lambda: create(store)]:
        with pytest.raises(ArtifactError, match="catalog needs repair"):
            operation()
    assert path.read_text() == "{corrupt"


def test_atomic_metadata_failure_rolls_back_and_preserves_existing(tmp_path, monkeypatch):
    store = ArtifactStore(tmp_path)
    first = create(store)
    before = store.index_path.read_bytes()
    with patch("app.artifacts.store.os.replace", side_effect=OSError("private server path")):
        with pytest.raises(ArtifactError) as error:
            create(store, request="two")
        assert "private server path" not in str(error.value)
        with pytest.raises(ArtifactError):
            store.delete(first["id"])
    assert store.index_path.read_bytes() == before
    assert store.list() == [first]
    assert len(list(store.files_dir.iterdir())) == 1
    with patch("app.artifacts.store.os.link", side_effect=OSError("no disk")):
        with pytest.raises(ArtifactError):
            create(store, request="two")
    assert store.list() == [first]


def test_storage_count_and_total_size_are_bounded(tmp_path, monkeypatch):
    store = ArtifactStore(tmp_path)
    create(store)
    monkeypatch.setattr("app.artifacts.store.MAX_ARTIFACTS", 1)
    with pytest.raises(ArtifactLimitError):
        create(store, request="two")
    monkeypatch.setattr("app.artifacts.store.MAX_ARTIFACTS", 200)
    monkeypatch.setattr("app.artifacts.store.MAX_TOTAL_BYTES", 1)
    with pytest.raises(ArtifactLimitError):
        create(store, request="two")


def test_orphaned_content_counts_toward_disk_limit(tmp_path, monkeypatch):
    store = ArtifactStore(tmp_path)
    store.files_dir.mkdir()
    (store.files_dir / ("a" * 32 + ".text")).write_bytes(b"x" * 100)
    monkeypatch.setattr("app.artifacts.store.MAX_TOTAL_BYTES", 100)
    with pytest.raises(ArtifactLimitError):
        create(store)
    assert store.list() == []


def test_symlink_escape_refused_where_supported(tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    store = ArtifactStore(tmp_path / "outputs")
    store.directory.mkdir()
    try:
        store.files_dir.symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("Windows developer symlink privilege is unavailable")
    with pytest.raises(ArtifactError):
        create(store)
    assert list(outside.iterdir()) == []


def test_shared_turn_schema_and_strict_action_with_existing_dialogue_repair(maya):
    original = reply_schema(maya)
    snapshot = json.dumps(original)
    schema = turn_schema(original)
    assert json.dumps(original) == snapshot
    assert schema["properties"]["beats"] == original["properties"]["beats"]
    payload = {"beats": [{"text": "Done", "emotion": "happy", "intensity": "high"}], "artifactAction": action().model_dump()}
    parsed = parse_artifact_turn(json.dumps(payload))
    assert parsed.reply.beats[0].intensity == .85
    assert parsed.action.content == 'print("Hello")\n'
    assert "artifactAction" not in parsed.reply.model_dump()
    payload["artifactAction"]["execute"] = True
    assert parse_artifact_turn(payload).error == "invalid_artifact_action"
    assert parse_artifact_turn('{"artifactAction":').reply is None
    assert parse_artifact_turn("Ordinary plain text").reply.beats[0].text == "Ordinary plain text"


def test_no_execution_import_or_compile_path_for_generated_python(tmp_path):
    marker = tmp_path / "must-not-exist"
    content = f"from pathlib import Path\nPath({str(marker)!r}).write_text('EXECUTED')\nraise RuntimeError('MUST NEVER RUN')\n"
    store = ArtifactStore(tmp_path / "outputs")
    artifact = create(store, action(content=content))
    assert store.read(artifact["id"]) == content
    assert not marker.exists()
    for source in (Path(__file__).parents[1] / "app" / "artifacts").glob("*.py"):
        tree = ast.parse(source.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                names = [alias.name for alias in node.names] if isinstance(node, ast.Import) else [node.module or ""]
                assert all(name.split('.')[0] not in {"subprocess", "runpy", "importlib", "pickle"} for name in names)
            if isinstance(node, ast.Call):
                if isinstance(node.func, ast.Name):
                    assert node.func.id not in {"exec", "eval", "compile", "__import__"}
                if isinstance(node.func, ast.Attribute):
                    assert node.func.attr not in {"system", "popen", "execv", "spawnv"}
