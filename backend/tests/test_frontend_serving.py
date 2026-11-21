import pytest

from app import create_app
from conftest import SqliteConfig


@pytest.fixture
def dist(tmp_path):
    (tmp_path / "index.html").write_text("<html>spa shell</html>")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("console.log('app')")
    # A file next to the dist folder that must never be reachable
    (tmp_path.parent / "secret.txt").write_text("top secret")
    return tmp_path


@pytest.fixture
def client(dist):
    class DistConfig(SqliteConfig):
        FRONTEND_DIST = str(dist)

    return create_app(DistConfig).test_client()


def test_root_serves_index(client):
    r = client.get("/")
    assert r.status_code == 200
    assert b"spa shell" in r.data
    assert r.headers["Cache-Control"] == "no-cache"


def test_existing_file_is_served(client):
    r = client.get("/assets/app.js")
    assert r.status_code == 200
    assert b"console.log" in r.data


@pytest.mark.parametrize("path", ["/login", "/confirm?token=abc", "/some/deep/route"])
def test_client_side_routes_fall_back_to_index(client, path):
    r = client.get(path)
    assert r.status_code == 200
    assert b"spa shell" in r.data


@pytest.mark.parametrize("path", ["/api", "/api/nope", "/api/auth/nope"])
def test_unknown_api_paths_are_json_404_not_index(client, path):
    r = client.get(path)
    assert r.status_code == 404
    assert r.get_json() == {"error": "Not found."}


def test_api_routes_still_work(client):
    assert client.get("/api/auth/me").status_code == 401


@pytest.mark.parametrize("path", ["/../secret.txt", "/..%2fsecret.txt", "/assets/../../secret.txt"])
def test_cannot_escape_dist_folder(client, path):
    r = client.get(path)
    assert b"top secret" not in r.data


def test_frontend_not_served_when_dist_unset():
    client = create_app(SqliteConfig).test_client()
    assert client.get("/").status_code == 404
