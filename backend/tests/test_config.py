import pytest

from app import config


@pytest.mark.parametrize(
    "given, expected",
    [
        ("postgres://u:p@host:5432/db", "postgresql+psycopg://u:p@host:5432/db"),
        ("postgresql://u:p@host/db", "postgresql+psycopg://u:p@host/db"),
        ("postgresql+psycopg://u:p@host/db", "postgresql+psycopg://u:p@host/db"),
        ("sqlite:///file.db", "sqlite:///file.db"),
    ],
)
def test_database_uri_uses_psycopg_driver(monkeypatch, given, expected):
    monkeypatch.setenv("DATABASE_URL", given)
    assert config._database_uri() == expected


def test_database_uri_default(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert config._database_uri().startswith("postgresql+psycopg://")


def test_frontend_url_precedence(monkeypatch):
    monkeypatch.delenv("FRONTEND_URL", raising=False)
    monkeypatch.delenv("RENDER_EXTERNAL_URL", raising=False)
    assert config._frontend_url() == "http://localhost:5173"

    monkeypatch.setenv("RENDER_EXTERNAL_URL", "https://thebox.onrender.com")
    assert config._frontend_url() == "https://thebox.onrender.com"

    monkeypatch.setenv("FRONTEND_URL", "https://thebox.example.com/")
    assert config._frontend_url() == "https://thebox.example.com"


@pytest.mark.parametrize("value", ["1", "true", "YES", " on "])
def test_bool_true_values(monkeypatch, value):
    monkeypatch.setenv("SOME_FLAG", value)
    assert config._bool("SOME_FLAG", False) is True


@pytest.mark.parametrize("value", ["0", "false", "", "no"])
def test_bool_false_values(monkeypatch, value):
    monkeypatch.setenv("SOME_FLAG", value)
    assert config._bool("SOME_FLAG", True) is False


def test_bool_default_when_unset(monkeypatch):
    monkeypatch.delenv("SOME_FLAG", raising=False)
    assert config._bool("SOME_FLAG", True) is True
    assert config._bool("SOME_FLAG", False) is False
