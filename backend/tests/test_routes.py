from datetime import datetime

from app import routes


def test_health_reports_database_ok(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.get_json() == {"status": "ok", "database": "ok"}


def test_health_reports_database_unavailable(client, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("db down")

    monkeypatch.setattr(routes.db.session, "execute", boom)
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.get_json() == {"status": "ok", "database": "unavailable"}


def test_demo_requires_login(client):
    r = client.get("/api/demo")
    assert r.status_code == 401
    assert "error" in r.get_json()


def test_demo_returns_sample_data(signed_in):
    r = signed_in.get("/api/demo")
    assert r.status_code == 200
    data = r.get_json()
    assert data["message"] == "Hello, user@example.com!"
    assert data["items"] == routes.DEMO_ITEMS
    assert datetime.fromisoformat(data["server_time"]).tzinfo is not None


def test_unknown_api_path_is_404(client):
    assert client.get("/api/nope").status_code == 404
