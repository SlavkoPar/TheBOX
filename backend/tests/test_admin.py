from io import BytesIO

from conftest import CREDS, token_from

ADMIN_CREDS = {"email": "admin@example.com", "password": "admin horse 1"}


def sign_in(app, outbox, creds):
    client = app.test_client()
    client.post("/api/auth/register", json=creds)
    client.post("/api/auth/confirm", json={"token": token_from(outbox)})
    assert client.post("/api/auth/login", json=creds).status_code == 200
    return client


def test_users_list_requires_sign_in(client):
    assert client.get("/api/admin/users").status_code == 401


def test_ordinary_user_cannot_list_users(signed_in):
    response = signed_in.get("/api/admin/users")
    assert response.status_code == 403
    assert response.get_json()["code"] == "not_admin"
    assert signed_in.get("/api/auth/me").get_json()["user"]["is_admin"] is False


def test_admin_sees_all_registered_users(app, signed_in, outbox):
    # An ordinary user with one file, someone who never confirmed, and the admin
    uploaded = signed_in.post(
        "/api/drive/files",
        data={"file": (BytesIO(b"12345"), "a.txt")},
        content_type="multipart/form-data",
    )
    assert uploaded.status_code == 201
    app.test_client().post(
        "/api/auth/register", json={"email": "new@example.com", "password": "pending horse"}
    )
    admin = sign_in(app, outbox, ADMIN_CREDS)

    assert admin.get("/api/auth/me").get_json()["user"]["is_admin"] is True
    response = admin.get("/api/admin/users")
    assert response.status_code == 200
    users = {user["email"]: user for user in response.get_json()["items"]}

    assert set(users) == {CREDS["email"], "new@example.com", "admin@example.com"}
    assert users[CREDS["email"]]["is_confirmed"] is True
    assert users[CREDS["email"]]["confirmed_at"]
    assert users[CREDS["email"]]["created_at"]
    assert users[CREDS["email"]]["file_count"] == 1
    assert users[CREDS["email"]]["storage_used"] == 5
    assert users[CREDS["email"]]["is_admin"] is False
    assert users["new@example.com"]["is_confirmed"] is False
    assert users["new@example.com"]["confirmed_at"] is None
    assert users["new@example.com"]["storage_used"] == 0
    assert users["admin@example.com"]["is_admin"] is True
    # Nothing secret is sent
    assert all("password_hash" not in user and "password" not in user for user in users.values())


def test_admin_address_is_matched_whatever_its_case(app, outbox):
    app.config["ADMIN_EMAILS"] = ["admin@example.com"]
    admin = sign_in(app, outbox, {**ADMIN_CREDS, "email": "Admin@Example.com"})
    assert admin.get("/api/admin/users").status_code == 200
