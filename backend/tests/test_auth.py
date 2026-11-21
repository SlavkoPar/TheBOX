import re

import pytest

from app import auth as auth_module
from app import create_app
from app.config import Config
from app.extensions import db


class SqliteConfig(Config):
    TESTING = True
    SECRET_KEY = "test"
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SQLALCHEMY_ENGINE_OPTIONS = {}
    SMTP_HOST = ""


@pytest.fixture
def app():
    app = create_app(SqliteConfig)
    with app.app_context():
        db.create_all()
        yield app
        db.drop_all()


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def outbox(monkeypatch):
    sent = []
    monkeypatch.setattr(
        auth_module, "send_email", lambda to, subject, body: sent.append((to, subject, body))
    )
    return sent


CREDS = {"email": "user@example.com", "password": "correct horse"}


def token_from(outbox):
    return re.search(r"token=(\S+)", outbox[-1][2]).group(1)


def test_register_confirm_login_flow(client, outbox):
    r = client.post("/api/auth/register", json={"email": " User@Example.com ", "password": CREDS["password"]})
    assert r.status_code == 201
    assert len(outbox) == 1
    assert outbox[0][0] == "user@example.com"

    # Cannot sign in before confirming
    r = client.post("/api/auth/login", json=CREDS)
    assert r.status_code == 403
    assert r.get_json()["code"] == "email_not_confirmed"

    token = token_from(outbox)
    assert client.post("/api/auth/confirm", json={"token": token}).status_code == 200
    # Confirming twice is harmless
    assert client.post("/api/auth/confirm", json={"token": token}).status_code == 200

    assert client.get("/api/auth/me").status_code == 401
    r = client.post("/api/auth/login", json=CREDS)
    assert r.status_code == 200
    assert r.get_json()["user"]["email"] == "user@example.com"
    assert client.get("/api/auth/me").get_json()["user"]["is_confirmed"] is True

    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401


@pytest.mark.parametrize(
    "payload",
    [
        {"email": "not-an-email", "password": "long enough"},
        {"email": "user@example.com", "password": "short"},
        {"email": "user@example.com"},
        {},
    ],
)
def test_register_validation(client, outbox, payload):
    assert client.post("/api/auth/register", json=payload).status_code == 400
    assert outbox == []


def test_register_existing_confirmed_email_sends_nothing(client, outbox):
    client.post("/api/auth/register", json=CREDS)
    client.post("/api/auth/confirm", json={"token": token_from(outbox)})

    r = client.post("/api/auth/register", json={"email": CREDS["email"], "password": "another password"})
    assert r.status_code == 201
    assert len(outbox) == 1
    # Original password still works; the second registration changed nothing
    assert client.post("/api/auth/login", json=CREDS).status_code == 200


def test_login_wrong_password(client, outbox):
    client.post("/api/auth/register", json=CREDS)
    r = client.post("/api/auth/login", json={"email": CREDS["email"], "password": "wrong password"})
    assert r.status_code == 401
    r = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "whatever123"})
    assert r.status_code == 401


def test_confirm_rejects_bad_and_expired_tokens(app, client, outbox):
    assert client.post("/api/auth/confirm", json={"token": "garbage"}).status_code == 400
    assert client.post("/api/auth/confirm", json={}).status_code == 400

    client.post("/api/auth/register", json=CREDS)
    app.config["CONFIRM_TOKEN_MAX_AGE"] = -1
    r = client.post("/api/auth/confirm", json={"token": token_from(outbox)})
    assert r.status_code == 400
    assert "expired" in r.get_json()["error"]


def test_resend_confirmation(client, outbox):
    client.post("/api/auth/register", json=CREDS)
    assert client.post("/api/auth/resend-confirmation", json={"email": CREDS["email"]}).status_code == 200
    assert len(outbox) == 2

    # Unknown address: same response, nothing sent
    assert client.post("/api/auth/resend-confirmation", json={"email": "nobody@example.com"}).status_code == 200
    assert len(outbox) == 2

    # Already confirmed: nothing sent
    client.post("/api/auth/confirm", json={"token": token_from(outbox)})
    client.post("/api/auth/resend-confirmation", json={"email": CREDS["email"]})
    assert len(outbox) == 2


def test_register_reports_mail_failure(client, monkeypatch):
    def boom(*args):
        raise OSError("smtp down")

    monkeypatch.setattr(auth_module, "send_email", boom)
    assert client.post("/api/auth/register", json=CREDS).status_code == 502


def test_demo_requires_login(client, outbox):
    assert client.get("/api/demo").status_code == 401

    client.post("/api/auth/register", json=CREDS)
    client.post("/api/auth/confirm", json={"token": token_from(outbox)})
    client.post("/api/auth/login", json=CREDS)

    r = client.get("/api/demo")
    assert r.status_code == 200
    data = r.get_json()
    assert data["message"] == "Hello, user@example.com!"
    assert len(data["items"]) == 3
    assert data["server_time"]
