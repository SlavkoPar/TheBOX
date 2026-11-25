import pytest

from app import auth as auth_module
from conftest import CREDS, token_from



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


def test_confirmation_email_links_to_frontend(client, outbox):
    client.post("/api/auth/register", json=CREDS)
    to, subject, body = outbox[0]
    assert "Confirm" in subject
    assert "http://frontend.test/confirm?token=" in body


def test_confirm_rejects_token_for_deleted_user(app, client, outbox):
    from app.extensions import db
    from app.models import User

    client.post("/api/auth/register", json=CREDS)
    db.session.delete(db.session.scalar(db.select(User)))
    db.session.commit()
    assert client.post("/api/auth/confirm", json={"token": token_from(outbox)}).status_code == 400


def test_password_is_stored_hashed(app, client, outbox):
    from app.extensions import db
    from app.models import User

    client.post("/api/auth/register", json=CREDS)
    user = db.session.scalar(db.select(User))
    assert CREDS["password"] not in user.password_hash
    assert user.check_password(CREDS["password"])
    assert not user.check_password("something else")


def test_non_json_bodies_are_rejected_cleanly(client, outbox):
    assert client.post("/api/auth/register", data="not json").status_code == 400
    assert client.post("/api/auth/login", data="not json").status_code == 401
    assert client.post("/api/auth/login", json={"email": 5, "password": ["x"]}).status_code == 401


# --- Forgotten password -----------------------------------------------------------

NEW_PASSWORD = "brand new horse"


def reset_token(outbox):
    assert "/reset-password?token=" in outbox[-1][2]
    return token_from(outbox)


def test_forgot_password_sets_a_new_one(signed_in, outbox):
    signed_in.post("/api/auth/logout")
    outbox.clear()

    r = signed_in.post("/api/auth/forgot-password", json={"email": " User@Example.com "})
    assert r.status_code == 200
    assert r.get_json()["message"] == auth_module.FORGOT_MESSAGE
    assert len(outbox) == 1 and outbox[0][0] == CREDS["email"]
    assert outbox[0][1] == "Set a new TheBOX password"
    token = reset_token(outbox)

    r = signed_in.post("/api/auth/reset-password", json={"token": token, "password": NEW_PASSWORD})
    assert r.status_code == 200

    assert signed_in.post("/api/auth/login", json=CREDS).status_code == 401  # old password
    r = signed_in.post("/api/auth/login", json={**CREDS, "password": NEW_PASSWORD})
    assert r.status_code == 200

    # The link works once
    r = signed_in.post("/api/auth/reset-password", json={"token": token, "password": "yet another 1"})
    assert r.status_code == 400
    assert r.get_json()["error"] == auth_module.RESET_INVALID


def test_forgot_password_does_not_reveal_unknown_addresses(client, outbox):
    r = client.post("/api/auth/forgot-password", json={"email": "nobody@example.com"})
    assert r.status_code == 200
    assert r.get_json()["message"] == auth_module.FORGOT_MESSAGE
    assert outbox == []
    assert client.post("/api/auth/forgot-password", json={}).status_code == 200


def test_reset_password_rejects_bad_tokens_and_weak_passwords(signed_in, outbox):
    from app.extensions import db
    from app.models import User

    signed_in.post("/api/auth/forgot-password", json={"email": CREDS["email"]})
    token = reset_token(outbox)

    def reset(**body):
        return signed_in.post("/api/auth/reset-password", json=body)

    assert reset(password=NEW_PASSWORD).status_code == 400
    assert reset(token="nonsense", password=NEW_PASSWORD).status_code == 400
    # A confirmation token is not a reset token
    confirm_token = auth_module.make_confirm_token(db.session.scalar(db.select(User)))
    assert reset(token=confirm_token, password=NEW_PASSWORD).status_code == 400
    r = reset(token=token, password="short")
    assert r.status_code == 400 and "at least 8" in r.get_json()["error"]
    # The token survives a refused password
    assert reset(token=token, password=NEW_PASSWORD).status_code == 200


def test_reset_link_expires(app, signed_in, outbox):
    signed_in.post("/api/auth/forgot-password", json={"email": CREDS["email"]})
    app.config["RESET_TOKEN_MAX_AGE"] = -1
    r = signed_in.post(
        "/api/auth/reset-password", json={"token": reset_token(outbox), "password": NEW_PASSWORD}
    )
    assert r.status_code == 400
    assert "expired" in r.get_json()["error"]


def test_reset_confirms_an_unconfirmed_account(client, outbox):
    client.post("/api/auth/register", json=CREDS)
    client.post("/api/auth/forgot-password", json={"email": CREDS["email"]})
    r = client.post(
        "/api/auth/reset-password", json={"token": reset_token(outbox), "password": NEW_PASSWORD}
    )
    assert r.status_code == 200
    assert client.post("/api/auth/login", json={**CREDS, "password": NEW_PASSWORD}).status_code == 200


def test_reset_email_failure_is_not_shown(client, outbox, monkeypatch):
    client.post("/api/auth/register", json=CREDS)

    def broken(*args):
        raise RuntimeError("smtp down")

    monkeypatch.setattr(auth_module, "send_email", broken)
    assert client.post("/api/auth/forgot-password", json={"email": CREDS["email"]}).status_code == 200
