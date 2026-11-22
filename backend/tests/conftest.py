import re

import pytest

from app import auth as auth_module
from app import files as files_module
from app import reminders as reminders_module
from app import create_app
from app.config import Config
from app.extensions import db

CREDS = {"email": "user@example.com", "password": "correct horse"}


class SqliteConfig(Config):
    TESTING = True
    SECRET_KEY = "test"
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SQLALCHEMY_ENGINE_OPTIONS = {}
    SMTP_HOST = ""
    FRONTEND_URL = "http://frontend.test"
    FRONTEND_DIST = ""


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
    """Emails the auth endpoints tried to send, as (to, subject, body) tuples."""
    sent = []
    for module in (auth_module, files_module, reminders_module):
        monkeypatch.setattr(
            module, "send_email", lambda to, subject, body: sent.append((to, subject, body))
        )
    return sent


def token_from(outbox):
    """Confirmation token from the most recent email."""
    return re.search(r"token=(\S+)", outbox[-1][2]).group(1)


@pytest.fixture
def signed_in(client, outbox):
    """A test client with a registered, confirmed and signed-in user."""
    client.post("/api/auth/register", json=CREDS)
    client.post("/api/auth/confirm", json={"token": token_from(outbox)})
    assert client.post("/api/auth/login", json=CREDS).status_code == 200
    return client


OTHER_CREDS = {"email": "other@example.com", "password": "another horse"}


@pytest.fixture
def other(app, outbox):
    """A second signed-in user, to check that users cannot reach each other's data."""
    client = app.test_client()
    client.post("/api/auth/register", json=OTHER_CREDS)
    client.post("/api/auth/confirm", json={"token": token_from(outbox)})
    assert client.post("/api/auth/login", json=OTHER_CREDS).status_code == 200
    outbox.clear()
    return client