from datetime import timedelta
from io import BytesIO

import pytest

from app import crypto
from app.extensions import db
from app.models import File, Folder, Share, utcnow

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
PASSWORD = "open sesame"


def upload(client, app_name="drive", name="notes.txt", content=b"hello world", folder_id=None):
    data = {"file": (BytesIO(content), name)}
    if folder_id is not None:
        data["folder_id"] = str(folder_id)
    return client.post(f"/api/{app_name}/files", data=data, content_type="multipart/form-data")


def uploaded(client, **kwargs):
    r = upload(client, **kwargs)
    assert r.status_code == 201, r.get_json()
    return r.get_json()["files"][0]


def new_folder(client, name, parent_id=None, app_name="drive"):
    r = client.post(f"/api/{app_name}/folders", json={"name": name, "parent_id": parent_id})
    assert r.status_code == 201, r.get_json()
    return r.get_json()


def items(client, folder=None, app_name="drive"):
    url = f"/api/{app_name}/items" + (f"?folder={folder}" if folder else "")
    return client.get(url).get_json()


def recipient(client, email="ana@example.com", first_name="Ana"):
    return client.post("/api/recipients", json={"first_name": first_name, "email": email}).get_json()


@pytest.fixture
def user(signed_in, outbox):
    outbox.clear()
    return signed_in


# --- Folders and browsing --------------------------------------------------------


@pytest.mark.parametrize("app_name", ["drive", "photos"])
def test_requires_login(client, app_name):
    assert client.get(f"/api/{app_name}/items").status_code == 401
    assert client.post(f"/api/{app_name}/folders", json={"name": "x"}).status_code == 401
    assert upload(client, app_name).status_code == 401
    assert client.post(f"/api/{app_name}/shares", json={}).status_code == 401


def test_subfolders_and_breadcrumbs(user):
    work = new_folder(user, "Work")
    reports = new_folder(user, "Reports", work["id"])
    deep = new_folder(user, "2026", reports["id"])
    uploaded(user, name="q4.txt", folder_id=deep["id"])
    uploaded(user, name="top.txt")

    top = items(user)
    assert top["folder"] is None
    assert top["breadcrumbs"] == []
    assert [f["name"] for f in top["folders"]] == ["Work"]
    assert [f["name"] for f in top["files"]] == ["top.txt"]

    inside = items(user, deep["id"])
    assert [b["name"] for b in inside["breadcrumbs"]] == ["Work", "Reports", "2026"]
    assert [f["name"] for f in inside["files"]] == ["q4.txt"]
    assert inside["folders"] == []


def test_folder_names_unique_per_parent(user):
    work = new_folder(user, "Work")
    assert user.post("/api/drive/folders", json={"name": "Work"}).status_code == 409
    new_folder(user, "Work", work["id"])  # same name is fine one level down
    other = new_folder(user, "Other")
    assert user.patch(f"/api/drive/folders/{other['id']}", json={"name": "Work"}).status_code == 409
    assert user.patch(f"/api/drive/folders/{other['id']}", json={"name": "Renamed"}).get_json()["name"] == "Renamed"
    assert user.post("/api/drive/folders", json={"name": " "}).status_code == 400
    assert user.post("/api/drive/folders", json={"name": "x", "parent_id": 9999}).status_code == 404


def test_deleting_a_folder_deletes_everything_inside(user):
    work = new_folder(user, "Work")
    sub = new_folder(user, "Sub", work["id"])
    uploaded(user, name="a.txt", folder_id=work["id"])
    uploaded(user, name="b.txt", folder_id=sub["id"])
    keep = uploaded(user, name="keep.txt")

    assert user.delete(f"/api/drive/folders/{work['id']}").status_code == 204

    assert db.session.scalars(db.select(Folder)).all() == []
    assert [f.id for f in db.session.scalars(db.select(File))] == [keep["id"]]


def test_drive_and_photos_are_separate(user):
    drive_folder = new_folder(user, "Shared name")
    new_folder(user, "Shared name", app_name="photos")  # no clash across apps
    uploaded(user, name="doc.txt")
    photo = uploaded(user, app_name="photos", name="cat.png", content=PNG)

    assert [f["name"] for f in items(user)["files"]] == ["doc.txt"]
    assert [f["name"] for f in items(user, app_name="photos")["files"]] == ["cat.png"]
    # Ids from one app are not reachable through the other
    assert user.get(f"/api/drive/files/{photo['id']}/content").status_code == 404
    assert user.get(f"/api/photos/items?folder={drive_folder['id']}").status_code == 404
    assert upload(user, "photos", "x.png", PNG, folder_id=drive_folder["id"]).status_code == 404


# --- Files ------------------------------------------------------------------------


def test_upload_view_download_rename_delete(user):
    file = uploaded(user, name="notes.txt", content=b"hello world")
    assert file["mime_type"] == "text/plain"
    assert file["size"] == 11
    assert file["is_encrypted"] is False

    r = user.get(f"/api/drive/files/{file['id']}/content")
    assert r.data == b"hello world"
    assert r.headers["Content-Disposition"].startswith("inline")
    assert r.headers["X-Content-Type-Options"] == "nosniff"

    r = user.get(f"/api/drive/files/{file['id']}/content?download=1")
    assert r.data == b"hello world"
    assert r.headers["Content-Disposition"] == "attachment; filename*=UTF-8''notes.txt"

    r = user.patch(f"/api/drive/files/{file['id']}", json={"name": "renamed čć.txt"})
    assert r.get_json()["name"] == "renamed čć.txt"

    assert user.delete(f"/api/drive/files/{file['id']}").status_code == 204
    assert user.get(f"/api/drive/files/{file['id']}/content").status_code == 404


def test_upload_several_files_at_once(user):
    r = user.post(
        "/api/drive/files",
        data={"file": [(BytesIO(b"a"), "a.txt"), (BytesIO(b"bb"), "b.txt")]},
        content_type="multipart/form-data",
    )
    assert r.status_code == 201
    assert [f["name"] for f in r.get_json()["files"]] == ["a.txt", "b.txt"]


def test_upload_needs_a_file_and_strips_paths(user):
    assert user.post("/api/drive/files", data={}, content_type="multipart/form-data").status_code == 400
    assert uploaded(user, name="..\\..\\evil/../name.txt")["name"] == "name.txt"


def test_active_content_is_never_served_inline(user):
    """HTML and SVG uploads must download, not render on the app's origin."""
    for name, content in (("page.html", b"<script>alert(1)</script>"), ("pic.svg", b"<svg onload='x'/>")):
        file = uploaded(user, name=name, content=content)
        r = user.get(f"/api/drive/files/{file['id']}/content")
        assert r.headers["Content-Disposition"].startswith("attachment"), name
        assert r.headers["X-Content-Type-Options"] == "nosniff"


def test_upload_too_large(app, user):
    app.config["MAX_CONTENT_LENGTH"] = 1024
    r = upload(user, content=b"x" * 5000)
    assert r.status_code == 413
    assert r.get_json() == {"error": "The upload is too large."}


def test_photos_accepts_only_images(user):
    assert uploaded(user, app_name="photos", name="cat.png", content=PNG)["mime_type"] == "image/png"
    r = upload(user, "photos", "notes.txt", b"hello")
    assert r.status_code == 400
    assert "image" in r.get_json()["error"]
    assert len(items(user, app_name="photos")["files"]) == 1


def test_edit_text_document(user):
    file = uploaded(user, name="notes.txt", content=b"old")
    r = user.put(f"/api/drive/files/{file['id']}/text", json={"content": "new text ž"})
    assert r.status_code == 200
    assert r.get_json()["size"] == len("new text ž".encode())
    assert user.get(f"/api/drive/files/{file['id']}/content").data.decode() == "new text ž"

    image = uploaded(user, name="cat.png", content=PNG)
    assert user.put(f"/api/drive/files/{image['id']}/text", json={"content": "x"}).status_code == 400
    assert user.put(f"/api/drive/files/{file['id']}/text", json={"content": 5}).status_code == 400


def test_users_cannot_reach_each_others_files(user, other):
    folder = new_folder(user, "Private")
    file = uploaded(user, name="secret.txt", folder_id=folder["id"])

    assert items(other)["folders"] == []
    assert other.get(f"/api/drive/items?folder={folder['id']}").status_code == 404
    assert other.get(f"/api/drive/files/{file['id']}/content").status_code == 404
    assert other.patch(f"/api/drive/files/{file['id']}", json={"name": "x"}).status_code == 404
    assert other.delete(f"/api/drive/files/{file['id']}").status_code == 404
    assert other.delete(f"/api/drive/folders/{folder['id']}").status_code == 404
    assert other.post(f"/api/drive/files/{file['id']}/encrypt", json={"password": PASSWORD}).status_code == 404
    assert upload(other, folder_id=folder["id"]).status_code == 404
    mine = recipient(other)
    r = other.post("/api/drive/shares", json={"file_ids": [file["id"]], "recipient_ids": [mine["id"]]})
    assert r.status_code == 404


# --- Encryption -------------------------------------------------------------------


def test_encrypt_then_read_with_password(user):
    file = uploaded(user, name="plan.txt", content=b"top secret plan")
    r = user.post(f"/api/drive/files/{file['id']}/encrypt", json={"password": PASSWORD})
    assert r.status_code == 200
    assert r.get_json()["is_encrypted"] is True
    assert r.get_json()["size"] == 15  # size of the original content

    stored = db.session.get(File, file["id"])
    assert b"top secret plan" not in stored.data
    assert stored.enc_salt and stored.enc_nonce

    r = user.get(f"/api/drive/files/{file['id']}/content")
    assert r.status_code == 403
    assert r.get_json()["code"] == "encrypted"

    r = user.post(f"/api/drive/files/{file['id']}/content", json={"password": "wrong password"})
    assert r.status_code == 403
    assert r.get_json()["code"] == "wrong_password"

    r = user.post(f"/api/drive/files/{file['id']}/content?download=1", json={"password": PASSWORD})
    assert r.status_code == 200
    assert r.data == b"top secret plan"
    assert r.headers["Content-Disposition"].startswith("attachment")


def test_decrypt_restores_the_document(user):
    file = uploaded(user, name="plan.txt", content=b"top secret plan")
    user.post(f"/api/drive/files/{file['id']}/encrypt", json={"password": PASSWORD})

    assert user.post(f"/api/drive/files/{file['id']}/decrypt", json={"password": "nope nope"}).status_code == 403
    assert db.session.get(File, file["id"]).is_encrypted is True  # unchanged after a wrong password

    r = user.post(f"/api/drive/files/{file['id']}/decrypt", json={"password": PASSWORD})
    assert r.get_json()["is_encrypted"] is False
    stored = db.session.get(File, file["id"])
    assert stored.data == b"top secret plan"
    assert stored.enc_salt is None and stored.enc_nonce is None
    assert user.get(f"/api/drive/files/{file['id']}/content").data == b"top secret plan"


def test_encryption_rules(user):
    file = uploaded(user)
    url = f"/api/drive/files/{file['id']}"
    assert user.post(f"{url}/encrypt", json={"password": "short"}).status_code == 400
    assert user.post(f"{url}/encrypt", json={}).status_code == 400
    assert user.post(f"{url}/decrypt", json={"password": PASSWORD}).status_code == 409  # not encrypted
    assert user.post(f"{url}/encrypt", json={"password": PASSWORD}).status_code == 200
    assert user.post(f"{url}/encrypt", json={"password": PASSWORD}).status_code == 409  # already encrypted
    assert user.put(f"{url}/text", json={"content": "x"}).status_code == 400  # must decrypt first

    photo = uploaded(user, app_name="photos", name="cat.png", content=PNG)
    assert user.post(f"/api/photos/files/{photo['id']}/encrypt", json={"password": PASSWORD}).status_code == 400


def test_crypto_roundtrip_and_tamper_detection():
    ciphertext, salt, nonce = crypto.encrypt(b"data", "password one")
    assert crypto.decrypt(ciphertext, "password one", salt, nonce) == b"data"
    with pytest.raises(crypto.WrongPassword):
        crypto.decrypt(ciphertext, "password two", salt, nonce)
    with pytest.raises(crypto.WrongPassword):
        crypto.decrypt(ciphertext[:-1] + bytes([ciphertext[-1] ^ 1]), "password one", salt, nonce)
    # Fresh salt and nonce every time
    assert crypto.encrypt(b"data", "password one")[0] != ciphertext


# --- Sharing ----------------------------------------------------------------------


def share(client, file_ids, recipient_ids, app_name="drive", **extra):
    return client.post(
        f"/api/{app_name}/shares",
        json={"file_ids": file_ids, "recipient_ids": recipient_ids, **extra},
    )


def test_share_emails_each_recipient_a_link(user, outbox):
    a = uploaded(user, name="a.txt", content=b"AAA")
    b = uploaded(user, name="b.txt", content=b"BBB")
    uploaded(user, name="not-shared.txt")
    ana, bo = recipient(user), recipient(user, "bo@example.com", "Bo")

    r = share(user, [a["id"], b["id"]], [ana["id"], bo["id"]], message="For the meeting.")
    assert r.status_code == 201
    body = r.get_json()
    assert sorted(body["sent"]) == ["ana@example.com", "bo@example.com"]
    assert body["failed"] == []
    assert body["link"].startswith("http://frontend.test/shared/")

    assert [m[0] for m in outbox] == ["ana@example.com", "bo@example.com"]
    to, subject, text = outbox[0]
    assert subject == "user@example.com shared 2 documents with you"
    assert "Hello Ana," in text
    assert "a.txt" in text and "b.txt" in text and "not-shared" not in text
    assert "For the meeting." in text
    assert body["link"] in text


def test_recipient_can_list_view_and_download_without_signing_in(app, user, outbox):
    a = uploaded(user, name="a.txt", content=b"AAA")
    hidden = uploaded(user, name="hidden.txt", content=b"HIDDEN")
    link = share(user, [a["id"]], [recipient(user)["id"]]).get_json()["link"]
    token = link.rsplit("/", 1)[1]

    visitor = app.test_client()  # no session
    listing = visitor.get(f"/api/shared/{token}").get_json()
    assert listing["shared_by"] == "user@example.com"
    assert listing["app"] == "drive"
    assert [f["name"] for f in listing["files"]] == ["a.txt"]

    r = visitor.get(f"/api/shared/{token}/files/{a['id']}")
    assert r.data == b"AAA"
    assert r.headers["Content-Disposition"].startswith("inline")
    r = visitor.get(f"/api/shared/{token}/files/{a['id']}?download=1")
    assert r.headers["Content-Disposition"].startswith("attachment")

    # Only the shared files are reachable, and only with the right token
    assert visitor.get(f"/api/shared/{token}/files/{hidden['id']}").status_code == 404
    assert visitor.get(f"/api/shared/wrong-token").status_code == 404
    assert visitor.get(f"/api/shared/wrong-token/files/{a['id']}").status_code == 404


def test_shared_encrypted_document_needs_its_password(app, user, outbox):
    file = uploaded(user, name="plan.txt", content=b"top secret plan")
    user.post(f"/api/drive/files/{file['id']}/encrypt", json={"password": PASSWORD})
    token = share(user, [file["id"]], [recipient(user)["id"]]).get_json()["share"]["token"]
    assert "password" in outbox[-1][2]

    visitor = app.test_client()
    assert visitor.get(f"/api/shared/{token}").get_json()["files"][0]["is_encrypted"] is True
    assert visitor.get(f"/api/shared/{token}/files/{file['id']}").status_code == 403
    assert visitor.post(f"/api/shared/{token}/files/{file['id']}", json={"password": "wrong one"}).status_code == 403
    assert visitor.post(f"/api/shared/{token}/files/{file['id']}", json={}).status_code == 400
    r = visitor.post(f"/api/shared/{token}/files/{file['id']}", json={"password": PASSWORD})
    assert r.data == b"top secret plan"


def test_photos_can_be_shared_the_same_way(app, user, outbox):
    photo = uploaded(user, app_name="photos", name="cat.png", content=PNG)
    r = share(user, [photo["id"]], [recipient(user)["id"]], app_name="photos")
    assert r.status_code == 201
    assert outbox[-1][1] == "user@example.com shared 1 photo with you"

    token = r.get_json()["share"]["token"]
    visitor = app.test_client()
    assert visitor.get(f"/api/shared/{token}").get_json()["app"] == "photos"
    r = visitor.get(f"/api/shared/{token}/files/{photo['id']}")
    assert r.data == PNG
    assert r.mimetype == "image/png"


def test_share_validation(user, outbox):
    file = uploaded(user)
    ana = recipient(user)
    photo = uploaded(user, app_name="photos", name="cat.png", content=PNG)

    assert share(user, [], [ana["id"]]).status_code == 400
    assert share(user, [file["id"]], []).status_code == 400
    assert share(user, "all", [ana["id"]]).status_code == 400
    assert share(user, [file["id"]], [9999]).status_code == 404
    assert share(user, [9999], [ana["id"]]).status_code == 404
    assert share(user, [photo["id"]], [ana["id"]]).status_code == 404  # a photo is not a Drive file
    assert outbox == []
    assert db.session.scalars(db.select(Share)).all() == []


def test_share_reports_recipients_whose_email_failed(user, monkeypatch):
    from app import files as files_module

    def flaky(to, subject, body):
        if to == "bo@example.com":
            raise OSError("smtp rejected")

    monkeypatch.setattr(files_module, "send_email", flaky)
    file = uploaded(user)
    r = share(user, [file["id"]], [recipient(user)["id"], recipient(user, "bo@example.com", "Bo")["id"]])
    assert r.status_code == 201
    assert r.get_json()["sent"] == ["ana@example.com"]
    assert r.get_json()["failed"] == ["bo@example.com"]


def test_expired_and_revoked_links_stop_working(app, user, outbox):
    file = uploaded(user)
    created = share(user, [file["id"]], [recipient(user)["id"]]).get_json()["share"]
    token = created["token"]
    assert created["expires_at"] is not None
    visitor = app.test_client()
    assert visitor.get(f"/api/shared/{token}").status_code == 200

    stored = db.session.get(Share, created["id"])
    stored.expires_at = utcnow() - timedelta(minutes=1)
    db.session.commit()
    assert visitor.get(f"/api/shared/{token}").status_code == 404
    assert visitor.get(f"/api/shared/{token}/files/{file['id']}").status_code == 404

    stored.expires_at = None  # never expires
    db.session.commit()
    assert visitor.get(f"/api/shared/{token}").status_code == 200

    assert [s["id"] for s in user.get("/api/drive/shares").get_json()["items"]] == [created["id"]]
    assert user.delete(f"/api/drive/shares/{created['id']}").status_code == 204
    assert visitor.get(f"/api/shared/{token}").status_code == 404


def test_deleting_a_file_or_recipient_keeps_shares_consistent(app, user, outbox):
    a, b = uploaded(user, name="a.txt"), uploaded(user, name="b.txt")
    ana = recipient(user)
    token = share(user, [a["id"], b["id"]], [ana["id"]]).get_json()["share"]["token"]

    assert user.delete(f"/api/drive/files/{a['id']}").status_code == 204
    assert user.delete(f"/api/recipients/{ana['id']}").status_code == 204

    visitor = app.test_client()
    assert [f["name"] for f in visitor.get(f"/api/shared/{token}").get_json()["files"]] == ["b.txt"]
    assert visitor.get(f"/api/shared/{token}/files/{a['id']}").status_code == 404
    assert user.get("/api/drive/shares").get_json()["items"][0]["recipients"] == []
