"""Production frontend serving: static files, SPA fallback, API precedence, traversal safety."""

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.web.frontend import FrontendMissingError, _safe_relative, mount_frontend

INDEX = "<!doctype html><title>Courtroom</title>"


@pytest.fixture
def dist(tmp_path):
    root = tmp_path / "dist"
    (root / "assets" / "audio").mkdir(parents=True)
    (root / "index.html").write_text(INDEX)
    (root / "assets" / "index-AbCd1234.js").write_text("console.log(1)")
    (root / "assets" / "x.js").write_text("console.log(2)")
    (root / "assets" / "audio" / "a.mp3").write_bytes(b"ID3" + b"\0" * 32)
    (root / "assets" / "font.woff2").write_bytes(b"wOF2" + b"\0" * 8)
    (root / "assets" / "p.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    (tmp_path / "secret.txt").write_text("top secret")
    return root


@pytest.fixture
def client(dist):
    app = create_app()
    mount_frontend(app, dist)
    return TestClient(app, base_url="http://127.0.0.1:5000", client=("127.0.0.1", 50000))


def test_root_serves_index_without_caching(client):
    r = client.get("/")
    assert r.status_code == 200 and r.text == INDEX
    assert r.headers["content-type"].startswith("text/html")
    assert r.headers["cache-control"] == "no-cache"
    assert r.headers["x-content-type-options"] == "nosniff"


@pytest.mark.parametrize("path,mime", [
    ("/assets/x.js", "text/javascript"), ("/assets/audio/a.mp3", "audio/mpeg"),
    ("/assets/font.woff2", "font/woff2"), ("/assets/p.png", "image/png"),
])
def test_assets_get_correct_mime_and_nosniff(client, path, mime):
    r = client.get(path)
    assert r.status_code == 200 and r.headers["content-type"].startswith(mime)
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["cache-control"] == "no-cache"


def test_hashed_bundle_is_cached_long(client):
    assert "immutable" in client.get("/assets/index-AbCd1234.js").headers["cache-control"]


def test_audio_supports_range_requests(client):
    r = client.get("/assets/audio/a.mp3", headers={"Range": "bytes=0-2"})
    assert r.status_code == 206 and r.content == b"ID3"


def test_head_request(client):
    assert client.head("/assets/x.js").status_code == 200


def test_deep_link_falls_back_to_index(client):
    for path in ("/settings", "/court/record/3", "/assets/audio"):
        r = client.get(path)
        assert r.status_code == 200 and r.text == INDEX, path


def test_missing_file_with_extension_is_404_not_index(client):
    for path in ("/assets/music/soundtrack.json", "/favicon.svg", "/assets/nope.mp3"):
        assert client.get(path).status_code == 404, path


def test_api_routes_still_win(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/json")


@pytest.mark.parametrize("path", ["/api/nope", "/api", "/api/", "/api/music/imports/zzz/extra"])
def test_unknown_api_is_json_404(client, path):
    r = client.get(path)
    assert r.status_code == 404 and r.headers["content-type"].startswith("application/json")
    assert r.json() == {"detail": "Not Found"}


@pytest.mark.parametrize("path", [
    "/%2e%2e/secret.txt", "/assets/%2e%2e/%2e%2e/secret.txt", "/..%2fsecret.txt", "/assets/..%2f..%2fsecret.txt",
    "/%2e%2e%5csecret.txt", "/assets%5c..%5c..%5csecret.txt", "//secret.txt", "/%00", "/assets/x.js%00.png",
    "/C:/Windows/win.ini", "/assets/x.js::$DATA", "/%2fetc/passwd",
])
def test_traversal_attempts_never_leak(client, path):
    r = client.get(path)
    assert "top secret" not in r.text
    assert r.status_code == 404 or (r.status_code == 200 and r.text == INDEX)


def test_unsafe_paths_rejected_directly():
    for bad in ("../x", "a/../../x", "a\\b", "/abs", "a\0b", "C:/x", "a/./b"):
        assert _safe_relative(bad) is None, bad
    assert _safe_relative("assets//x.js") == "assets/x.js"


def test_symlink_escape_is_blocked(dist, tmp_path):
    try:
        (dist / "assets" / "leak.txt").symlink_to(tmp_path / "secret.txt")
    except OSError:
        pytest.skip("symlinks unavailable")
    app = create_app()
    mount_frontend(app, dist)
    assert "top secret" not in TestClient(app).get("/assets/leak.txt").text


def test_post_to_static_path_not_allowed(client):
    assert client.post("/assets/x.js").status_code == 405


def test_missing_dist_raises(tmp_path):
    with pytest.raises(FrontendMissingError):
        mount_frontend(create_app(), tmp_path / "nope")


def test_missing_index_raises(tmp_path):
    (tmp_path / "empty").mkdir()
    with pytest.raises(FrontendMissingError, match="index.html"):
        mount_frontend(create_app(), tmp_path / "empty")


# The local-access guard must accept the production origin (same-origin on 127.0.0.1:<random port>).
GUARDED = ["/api/provider-profiles", "/api/music/imports", "/api/artifacts"]
PORT = 51734


def prod_client(app, host="127.0.0.1", address="127.0.0.1"):
    return TestClient(app, base_url=f"http://{host}:{PORT}", client=(address, 50000))


@pytest.fixture
def prod_app(dist):
    app = create_app()
    mount_frontend(app, dist)
    return app


@pytest.mark.parametrize("path", GUARDED)
def test_guard_accepts_production_same_origin(prod_app, path):
    for host in ("127.0.0.1", "localhost"):
        headers = {"Origin": f"http://{host}:{PORT}", "Sec-Fetch-Site": "same-origin"}
        assert prod_client(prod_app, host).get(path, headers=headers).status_code != 403, (host, path)
    assert prod_client(prod_app).get(path).status_code != 403  # no Origin header (plain GET navigation/fetch)


@pytest.mark.parametrize("path", GUARDED)
def test_guard_rejects_cross_origin_and_remote(prod_app, path):
    local = prod_client(prod_app)
    assert local.get(path, headers={"Origin": "https://evil.example"}).status_code == 403
    assert local.get(path, headers={"Origin": "http://127.0.0.1:9999"}).status_code == 403  # other local port
    assert local.get(path, headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403
    assert prod_client(prod_app, address="192.0.2.1").get(path).status_code == 403  # remote peer
    assert prod_client(prod_app, host="example.com").get(path).status_code == 403  # rebinding-style Host
