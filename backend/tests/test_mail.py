import logging

import pytest

from app import mail


class FakeSMTP:
    """Stands in for smtplib.SMTP / SMTP_SSL and records what was done."""

    instances = []

    def __init__(self, host, port, **kwargs):
        self.host, self.port, self.kwargs = host, port, kwargs
        self.calls = []
        self.messages = []
        FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.calls.append("quit")

    def starttls(self, context=None):
        self.calls.append("starttls")

    def login(self, username, password):
        self.calls.append(("login", username, password))

    def send_message(self, message):
        self.calls.append("send")
        self.messages.append(message)


class FakeSMTPSSL(FakeSMTP):
    pass


@pytest.fixture
def smtp(app, monkeypatch):
    FakeSMTP.instances = []
    monkeypatch.setattr(mail.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(mail.smtplib, "SMTP_SSL", FakeSMTPSSL)
    app.config.update(
        SMTP_HOST="smtp.test",
        SMTP_PORT=587,
        SMTP_USERNAME="mailer",
        SMTP_PASSWORD="secret",
        SMTP_USE_TLS=True,
        SMTP_USE_SSL=False,
        MAIL_FROM="TheBOX <no-reply@thebox.test>",
    )
    return FakeSMTP.instances


def test_without_smtp_host_email_is_logged_not_sent(app, monkeypatch, caplog):
    def fail(*args, **kwargs):
        raise AssertionError("SMTP must not be used when SMTP_HOST is empty")

    monkeypatch.setattr(mail.smtplib, "SMTP", fail)
    monkeypatch.setattr(mail.smtplib, "SMTP_SSL", fail)

    with caplog.at_level(logging.WARNING):
        mail.send_email("user@example.com", "Hello", "the body http://link")

    assert "user@example.com" in caplog.text
    assert "the body http://link" in caplog.text


def test_sends_with_starttls_and_login(smtp):
    mail.send_email("user@example.com", "Hello", "the body")

    (server,) = smtp
    assert type(server) is FakeSMTP
    assert (server.host, server.port) == ("smtp.test", 587)
    assert server.kwargs["timeout"] == 10
    assert server.calls == ["starttls", ("login", "mailer", "secret"), "send", "quit"]

    (message,) = server.messages
    assert message["To"] == "user@example.com"
    assert message["From"] == "TheBOX <no-reply@thebox.test>"
    assert message["Subject"] == "Hello"
    assert message.get_content().strip() == "the body"


def test_implicit_ssl_skips_starttls(app, smtp):
    app.config.update(SMTP_USE_SSL=True, SMTP_PORT=465)
    mail.send_email("user@example.com", "Hello", "the body")

    (server,) = smtp
    assert type(server) is FakeSMTPSSL
    assert server.port == 465
    assert "starttls" not in server.calls
    assert "send" in server.calls


def test_no_login_without_username_and_no_starttls_when_disabled(app, smtp):
    app.config.update(SMTP_USERNAME="", SMTP_USE_TLS=False)
    mail.send_email("user@example.com", "Hello", "the body")

    (server,) = smtp
    assert server.calls == ["send", "quit"]


def test_smtp_errors_propagate(app, smtp, monkeypatch):
    def boom(self, message):
        raise OSError("connection lost")

    monkeypatch.setattr(FakeSMTP, "send_message", boom)
    with pytest.raises(OSError):
        mail.send_email("user@example.com", "Hello", "the body")
