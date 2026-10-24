"""Imported-music library: content validation, storage safety, loop persistence. No real audio needed."""

import json
from urllib.parse import quote

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.music_routes import router
from app.music.library import MusicLibrary
from app.music.sniff import sanitize_title, sniff_audio

MP3_ID3 = b"ID3\x03\x00\x00\x00\x00\x00\x00" + b"\x00" * 64
MP3_SYNC = b"\xff\xfb\x90\x00" + b"\x00" * 64
OGG = b"OggS\x00\x02" + b"\x00" * 64
WAV = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 64
FLAC = b"fLaC\x00\x00\x00\x22" + b"\x00" * 64
SAMPLES = {"mp3": MP3_ID3, "ogg": OGG, "wav": WAV, "flac": FLAC}
MIMES = {"mp3": "audio/mpeg", "ogg": "audio/ogg", "wav": "audio/wav", "flac": "audio/flac"}
LOOP = {"startSample": 1000, "endSample": 441000, "sampleRate": 44100, "confidence": 0.82,
        "provenance": "user-accepted"}


def make_app(directory, max_bytes=64 * 1024 * 1024):
    app = FastAPI()
    app.state.music_library = MusicLibrary(directory, max_bytes)
    app.include_router(router)
    return app


def local(app, host="localhost", address="127.0.0.1"):
    return TestClient(app, base_url=f"http://{host}", client=(address, 50000))


@pytest.fixture
def directory(tmp_path):
    return tmp_path / "music"


@pytest.fixture
def client(directory):
    return local(make_app(directory))


def upload(client, data, name="song.mp3", headers=None):
    return client.post("/api/music/imports", content=data, headers={"X-Filename": quote(name), **(headers or {})})


def loop_body(**changes):
    body = {**LOOP, **changes}
    return {key: value for key, value in body.items() if value is not None}


@pytest.mark.parametrize("kind", list(SAMPLES))
def test_valid_upload_each_format(client, directory, kind):
    response = upload(client, SAMPLES[kind], f"My Song.{kind}")
    assert response.status_code == 201
    record = response.json()
    assert record["format"] == kind and record["mime"] == MIMES[kind]
    assert record["title"] == "My Song" and record["available"] is True and record["loop"] is None
    assert response.headers["cache-control"] == "no-store"
    stored = list((directory / "audio").iterdir())
    assert [item.name for item in stored] == [f"{record['id']}.{kind}"]
    assert set(record) == {"id", "title", "format", "mime", "sizeBytes", "createdAt", "available", "loop"}
    assert str(directory) not in json.dumps(record)


def test_mp3_frame_sync_without_id3(client):
    assert sniff_audio(MP3_SYNC).name == "mp3"
    assert upload(client, MP3_SYNC).status_code == 201


def test_content_not_extension_or_content_type(client, directory):
    response = client.post("/api/music/imports", content=b"MZ\x90\x00" + b"\x00" * 64,
                           headers={"X-Filename": "evil.mp3", "Content-Type": "audio/mpeg"})
    assert response.status_code == 415
    # An OGG file named .exe is still accepted as OGG and stored with a server-chosen extension.
    ok = upload(client, OGG, "payload.exe")
    assert ok.status_code == 201 and ok.json()["format"] == "ogg"
    assert not list((directory / "audio").glob("*.exe"))


@pytest.mark.parametrize("data", [b"", b"abc", b"RIFF\x00\x00\x00\x00AVI " + b"\x00" * 32, b"\xff\xff\xff\xff" + b"\x00" * 32,
                                  b"<html><script>alert(1)</script></html>" * 4])
def test_unknown_content_rejected_and_nothing_left(client, directory, data):
    assert upload(client, data).status_code == 415
    assert client.get("/api/music/imports").json() == {"tracks": []}
    assert not [item for item in (directory / "audio").iterdir()] if (directory / "audio").exists() else True


def test_oversized_body_rejected_without_leftovers(directory):
    client = local(make_app(directory, max_bytes=1024))
    assert upload(client, OGG + b"\x00" * 2048).status_code == 413
    assert upload(client, OGG + b"\x00" * 900).status_code == 201
    assert len(list((directory / "audio").iterdir())) == 1


def test_oversized_chunked_stream_rejected(directory):
    client = local(make_app(directory, max_bytes=1024))

    def chunks():
        yield OGG
        for _ in range(10):
            yield b"\x00" * 400

    assert upload(client, chunks()).status_code == 413
    assert list((directory / "audio").iterdir()) == []


@pytest.mark.parametrize("name", ["../../evil.mp3", "..\\..\\evil.mp3", "/etc/passwd", "C:\\Windows\\win.ini",
                                  "%2e%2e%2f%2e%2e%2fx.mp3", "a\x00b.mp3", "con.mp3", "<b>x</b>.mp3", ""])
def test_hostile_filenames_never_touch_the_filesystem(client, directory, name):
    response = client.post("/api/music/imports", content=OGG, headers={"X-Filename": quote(name, safe="") if "%" not in name else name})
    assert response.status_code == 201
    record = response.json()
    assert "/" not in record["title"] and "\\" not in record["title"] and ".." not in record["title"]
    assert "<" not in record["title"] and "\x00" not in record["title"]
    for path in directory.rglob("*"):
        assert directory in path.parents
    assert [item.name for item in (directory / "audio").iterdir()] == [f"{record['id']}.ogg"]


def test_sanitize_title_rules():
    assert sanitize_title("My%20Cool%20Song.MP3") == "My Cool Song"
    assert sanitize_title("..\\..\\x\\theme.flac") == "theme"
    assert sanitize_title("CON") == "Imported track"
    assert sanitize_title("nul.txt") == "Imported track"
    assert sanitize_title("a" * 500) == "a" * 80
    assert sanitize_title("\x01\x02\u202e") == "Imported track"
    assert sanitize_title(None) == "Imported track"
    assert sanitize_title("%FF%FEbad") .endswith("bad")


@pytest.mark.parametrize("bad_id", ["../x", "..%5Cx", "%2e%2e/x", "a" * 32, "A" * 32, "0" * 31, "0" * 33, "x/..", "%00"])
def test_track_id_traversal_rejected(client, bad_id):
    for method, suffix in [("get", "/audio"), ("delete", ""), ("put", "/loop"), ("patch", "")]:
        kwargs = {"json": loop_body()} if method == "put" else {"json": {"title": "x"}} if method == "patch" else {}
        response = getattr(client, method)(f"/api/music/imports/{bad_id}{suffix}", **kwargs)
        assert response.status_code in (404, 405, 422), (method, bad_id, response.status_code)


def test_tampered_index_cannot_escape_storage(client, directory):
    record = upload(client, OGG).json()
    outside = directory / "secret.ogg"
    outside.write_bytes(OGG)
    library = client.app.state.music_library
    library._tracks[record["id"]] = library._tracks[record["id"]].model_copy(update={"id": "../secret"})
    assert library.audio_path(library._tracks[record["id"]]) is None


def test_list_get_audio_delete(client, directory):
    first = upload(client, OGG + b"\x01" * 40, "one.ogg").json()
    second = upload(client, FLAC, "two.flac").json()
    listing = client.get("/api/music/imports")
    assert listing.headers["cache-control"] == "no-store"
    assert [item["id"] for item in listing.json()["tracks"]] == [first["id"], second["id"]]

    audio = client.get(f"/api/music/imports/{first['id']}/audio")
    assert audio.status_code == 200 and audio.content == OGG + b"\x01" * 40
    assert audio.headers["content-type"].startswith("audio/ogg")
    assert audio.headers["x-content-type-options"] == "nosniff"
    assert audio.headers["content-disposition"] == "inline"
    assert str(directory) not in json.dumps(dict(audio.headers))
    ranged = client.get(f"/api/music/imports/{first['id']}/audio", headers={"Range": "bytes=0-3"})
    assert ranged.status_code == 206 and ranged.content == b"OggS"

    assert client.delete(f"/api/music/imports/{first['id']}").status_code == 204
    assert client.get(f"/api/music/imports/{first['id']}/audio").status_code == 404
    assert client.delete(f"/api/music/imports/{first['id']}").status_code == 404
    assert [item["id"] for item in client.get("/api/music/imports").json()["tracks"]] == [second["id"]]
    assert [item.name for item in (directory / "audio").iterdir()] == [f"{second['id']}.flac"]


def test_missing_file_is_flagged_not_a_crash(client, directory):
    record = upload(client, WAV).json()
    (directory / "audio" / f"{record['id']}.wav").unlink()
    listed = client.get("/api/music/imports").json()["tracks"]
    assert listed[0]["available"] is False
    assert client.get(f"/api/music/imports/{record['id']}/audio").status_code == 404
    assert client.delete(f"/api/music/imports/{record['id']}").status_code == 204


def test_rename(client):
    record = upload(client, OGG, "old.ogg").json()
    renamed = client.patch(f"/api/music/imports/{record['id']}", json={"title": "../New: Name?"})
    assert renamed.status_code == 200 and renamed.json()["title"] == "New Name"
    assert client.patch(f"/api/music/imports/{record['id']}", json={"title": ""}).status_code == 422
    assert client.patch(f"/api/music/imports/{record['id']}", json={"title": "x", "path": "y"}).status_code == 422


def test_loop_persistence_and_reload(directory):
    client = local(make_app(directory))
    record = upload(client, OGG).json()
    saved = client.put(f"/api/music/imports/{record['id']}/loop", json=loop_body(crossfadeMs=20, note="ok"))
    assert saved.status_code == 200
    assert saved.json()["loop"] == {
        "region": {"startSample": 1000, "endSample": 441000, "sampleRate": 44100, "crossfadeMs": 20.0},
        "confidence": 0.82, "provenance": "user-accepted", "note": "ok"}
    reloaded = local(make_app(directory))
    listed = reloaded.get("/api/music/imports").json()["tracks"]
    assert listed[0]["id"] == record["id"] and listed[0]["loop"]["region"]["endSample"] == 441000
    cleared = reloaded.put(f"/api/music/imports/{record['id']}/loop", json={"provenance": "none"})
    assert cleared.json()["loop"]["region"] is None
    assert client.put(f"/api/music/imports/{'0' * 32}/loop", json=loop_body()).status_code == 404


@pytest.mark.parametrize("changes", [
    {"startSample": 5000, "endSample": 5000}, {"startSample": 9, "endSample": 3}, {"startSample": -1},
    {"startSample": 1.5}, {"startSample": True}, {"startSample": "10"}, {"sampleRate": 100}, {"sampleRate": 10**7},
    {"confidence": 1.5}, {"confidence": -0.1}, {"confidence": float("nan")}, {"provenance": "curated-analysis"},
    {"provenance": "bogus"}, {"crossfadeMs": -1}, {"crossfadeMs": 9999}, {"crossfadeMs": 500, "endSample": 2000},
    {"startSample": None}, {"extra": 1}, {"note": "x" * 500},
])
def test_invalid_loops_rejected(client, changes):
    record = upload(client, OGG).json()
    body = {**LOOP, **changes}
    body = {key: value for key, value in body.items() if value is not None}
    response = client.put(f"/api/music/imports/{record['id']}/loop", content=json.dumps(body, allow_nan=True),
                          headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert client.get("/api/music/imports").json()["tracks"][0]["loop"] is None


def test_corrupt_library_recovers_orphaned_audio(directory):
    client = local(make_app(directory))
    record = upload(client, FLAC).json()
    (directory / "library.json").write_text("{not json", encoding="utf-8")
    recovered = local(make_app(directory))
    tracks = recovered.get("/api/music/imports").json()["tracks"]
    assert [item["id"] for item in tracks] == [record["id"]] and tracks[0]["title"] == "Recovered track"
    assert list(directory.glob("library.corrupt-*.json"))
    assert json.loads((directory / "library.json").read_text(encoding="utf-8"))["version"] == 1


def test_schema_invalid_library_also_recovers(directory):
    directory.mkdir(parents=True)
    (directory / "library.json").write_text(json.dumps({"version": 7, "tracks": "nope"}), encoding="utf-8")
    assert local(make_app(directory)).get("/api/music/imports").json() == {"tracks": []}


def test_index_write_is_atomic_no_temp_leftovers(client, directory):
    upload(client, OGG)
    assert not [item for item in directory.iterdir() if item.name.startswith(".library-")]
    assert not [item for item in (directory / "audio").iterdir() if item.name.startswith(".upload-")]


def test_remote_and_cross_origin_requests_rejected(directory):
    app = make_app(directory)
    remote = local(app, "localhost", "192.0.2.1")
    assert remote.get("/api/music/imports").status_code == 403
    near = local(app)
    assert near.get("/api/music/imports", headers={"Origin": "https://evil.example"}).status_code == 403
    assert near.get("/api/music/imports", headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403
    assert upload(near, OGG, headers={"Origin": "http://evil.example"}).status_code == 403
    assert near.get("/api/music/imports", headers={"Origin": "http://localhost", "Sec-Fetch-Site": "same-origin"}).status_code == 200
    assert not (directory / "audio").exists() or not list((directory / "audio").iterdir())
