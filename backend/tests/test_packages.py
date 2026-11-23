from datetime import timedelta

from app import packages as packages_module
from app.extensions import db
from app.models import Package, utcnow

from test_files import PNG, new_folder, recipient, uploaded


def make(client, **fields):
    body = {"name": "For the board", "file_ids": [], "folder_ids": [], "recipient_ids": []}
    r = client.post("/api/packages", json={**body, **fields})
    assert r.status_code == 201, r.get_json()
    return r.get_json()


def token_of(package):
    return package["link"].rsplit("/", 1)[1]


def shared_names(client, package):
    listing = client.get(f"/api/shared/{token_of(package)}").get_json()
    return [(f["path"], f["name"]) for f in listing["files"]]


def test_packages_require_sign_in(client):
    assert client.get("/api/packages").status_code == 401
    assert client.post("/api/packages", json={"name": "x"}).status_code == 401


def test_a_package_holds_files_from_different_folders_and_apps(signed_in):
    work = new_folder(signed_in, "Work")
    reports = new_folder(signed_in, "Reports", parent_id=work["id"])
    top = uploaded(signed_in, name="top.txt")
    deep = uploaded(signed_in, name="deep.txt", folder_id=reports["id"])
    photo = uploaded(signed_in, app_name="photos", name="cat.png", content=PNG)

    package = make(signed_in, file_ids=[top["id"], deep["id"], photo["id"]], message="Have a look")

    assert package["name"] == "For the board"
    assert package["message"] == "Have a look"
    assert package["link"].startswith("http://frontend.test/shared/")
    assert package["file_count"] == 3
    assert [(f["app"], f["path"], f["name"]) for f in package["files"]] == [
        ("drive", "Work / Reports", "deep.txt"),
        ("drive", "", "top.txt"),
        ("photos", "", "cat.png"),
    ]
    assert package["sends"] == []
    assert signed_in.get("/api/packages").get_json()["items"] == [package]
    assert signed_in.get(f"/api/packages/{package['id']}").get_json() == package


def test_a_folder_in_a_package_is_live(signed_in):
    work = new_folder(signed_in, "Work")
    sub = new_folder(signed_in, "Sub", parent_id=work["id"])
    uploaded(signed_in, name="a.txt", folder_id=work["id"])
    uploaded(signed_in, name="b.txt", folder_id=sub["id"])
    lone = uploaded(signed_in, name="lone.txt")

    package = make(signed_in, folder_ids=[work["id"]], file_ids=[lone["id"]])
    assert package["folders"][0]["name"] == "Work"
    assert package["folders"][0]["file_count"] == 2
    assert package["file_count"] == 3
    assert shared_names(signed_in, package) == [
        ("", "lone.txt"),
        ("Work", "a.txt"),
        ("Work / Sub", "b.txt"),
    ]

    # A file added to the folder later is behind the link too; a trashed one is not.
    added = uploaded(signed_in, name="c.txt", folder_id=work["id"])
    signed_in.delete(f"/api/drive/folders/{sub['id']}")
    assert shared_names(signed_in, package) == [
        ("", "lone.txt"),
        ("Work", "a.txt"),
        ("Work", "c.txt"),
    ]
    token = token_of(package)
    assert signed_in.get(f"/api/shared/{token}/files/{added['id']}").data == b"hello world"


def test_validation(signed_in, other):
    file = uploaded(signed_in)
    theirs = uploaded(other, name="theirs.txt")
    their_folder = new_folder(other, "Theirs")
    their_recipient = recipient(other)

    def error(**fields):
        body = {"name": "P", "file_ids": [file["id"]], **fields}
        r = signed_in.post("/api/packages", json=body)
        return r.status_code, r.get_json()["error"]

    assert error(name=" ") == (400, "Name is required.")
    assert error(file_ids=[]) == (400, "Add at least one file or folder to the package.")
    assert error(file_ids="1") == (400, "Files must be a list of ids.")
    assert error(file_ids=[theirs["id"]]) == (404, "File not found.")
    assert error(folder_ids=[their_folder["id"]]) == (404, "Folder not found.")
    assert error(recipient_ids=[their_recipient["id"]]) == (404, "Recipient not found.")

    signed_in.delete(f"/api/drive/files/{file['id']}")
    assert error() == (404, "File not found.")  # in the trash
    assert signed_in.get("/api/packages").get_json()["items"] == []


def test_edit_a_package(signed_in):
    first = uploaded(signed_in, name="first.txt")
    second = uploaded(signed_in, name="second.txt")
    folder = new_folder(signed_in, "Work")
    ana = recipient(signed_in)
    package = make(signed_in, file_ids=[first["id"]])
    url = f"/api/packages/{package['id']}"

    # PATCH changes only what is sent
    r = signed_in.patch(url, json={"name": "Renamed"})
    assert r.status_code == 200
    assert r.get_json()["name"] == "Renamed"
    assert [f["name"] for f in r.get_json()["files"]] == ["first.txt"]

    r = signed_in.patch(
        url,
        json={
            "file_ids": [second["id"]],
            "folder_ids": [folder["id"]],
            "recipient_ids": [ana["id"]],
            "message": "Updated",
        },
    )
    edited = r.get_json()
    assert [f["name"] for f in edited["files"]] == ["second.txt"]
    assert [f["name"] for f in edited["folders"]] == ["Work"]
    assert [p["email"] for p in edited["recipients"]] == ["ana@example.com"]
    assert edited["message"] == "Updated"
    assert edited["link"] == package["link"]  # the link stays the same
    assert shared_names(signed_in, edited) == [("", "second.txt")]

    # It cannot be emptied
    r = signed_in.patch(url, json={"file_ids": [], "folder_ids": []})
    assert r.status_code == 400
    assert [f["name"] for f in signed_in.get(url).get_json()["files"]] == ["second.txt"]


def test_send_emails_the_recipients_and_records_history(signed_in, outbox):
    folder = new_folder(signed_in, "Work")
    uploaded(signed_in, name="inside.txt", folder_id=folder["id"])
    file = uploaded(signed_in, name="report.txt")
    ana = recipient(signed_in)
    bob = recipient(signed_in, "bob@example.com", "Bob")
    package = make(
        signed_in,
        file_ids=[file["id"]],
        folder_ids=[folder["id"]],
        recipient_ids=[ana["id"], bob["id"]],
        message="Please read",
    )
    outbox.clear()

    r = signed_in.post(f"/api/packages/{package['id']}/send")
    assert r.status_code == 200, r.get_json()
    result = r.get_json()
    assert result["sent"] == ["ana@example.com", "bob@example.com"]
    assert result["failed"] == []
    assert result["link"] == package["link"]

    assert [to for to, _, _ in outbox] == ["ana@example.com", "bob@example.com"]
    _, subject, body = outbox[0]
    assert subject == "user@example.com sent you “For the board”"
    assert "Hello Ana," in body
    assert "(2 files)" in body
    assert "  - Work (folder)" in body
    assert "  - report.txt" in body
    assert "Please read" in body
    assert package["link"] in body

    (send,) = result["package"]["sends"]
    assert send["message"] == "Please read"
    assert send["recipients"] == [
        {"name": "Ana", "email": "ana@example.com", "sent": True},
        {"name": "Bob", "email": "bob@example.com", "sent": True},
    ]
    assert send["items"] == [
        {"kind": "folder", "app": "drive", "name": "Work", "path": "", "file_count": 1},
        {"kind": "file", "app": "drive", "name": "report.txt", "path": ""},
    ]


def test_history_keeps_what_was_sent_after_the_package_changes(signed_in, outbox):
    old = uploaded(signed_in, name="old.txt")
    new = uploaded(signed_in, name="new.txt")
    ana = recipient(signed_in)
    bob = recipient(signed_in, "bob@example.com", "Bob")
    package = make(signed_in, file_ids=[old["id"]], recipient_ids=[ana["id"]])
    url = f"/api/packages/{package['id']}"

    signed_in.post(f"{url}/send")
    signed_in.patch(url, json={"file_ids": [new["id"]], "recipient_ids": [bob["id"]]})
    signed_in.delete(f"/api/drive/files/{old['id']}?permanent=1")
    signed_in.delete(f"/api/recipients/{ana['id']}")
    signed_in.post(f"{url}/send")

    sends = signed_in.get(url).get_json()["sends"]  # newest first
    assert [[i["name"] for i in s["items"]] for s in sends] == [["new.txt"], ["old.txt"]]
    assert [[p["email"] for p in s["recipients"]] for s in sends] == [
        ["bob@example.com"],
        ["ana@example.com"],
    ]


def test_send_needs_recipients_and_files(signed_in, outbox):
    folder = new_folder(signed_in, "Empty")
    ana = recipient(signed_in)
    package = make(signed_in, folder_ids=[folder["id"]])
    url = f"/api/packages/{package['id']}"
    outbox.clear()

    r = signed_in.post(f"{url}/send")
    assert (r.status_code, r.get_json()["error"]) == (400, "This package has no files to send.")

    uploaded(signed_in, folder_id=folder["id"])
    r = signed_in.post(f"{url}/send")
    assert r.get_json()["error"] == "Add at least one recipient to the package."

    signed_in.patch(url, json={"recipient_ids": [ana["id"]]})
    assert signed_in.post(f"{url}/send").status_code == 200
    assert len(outbox) == 1


def test_a_failed_email_is_reported_and_recorded(signed_in, outbox, monkeypatch):
    file = uploaded(signed_in)
    ana = recipient(signed_in)
    bob = recipient(signed_in, "bob@example.com", "Bob")
    package = make(signed_in, file_ids=[file["id"]], recipient_ids=[ana["id"], bob["id"]])

    def flaky(to, subject, body):
        if to == "bob@example.com":
            raise OSError("smtp down")

    monkeypatch.setattr(packages_module, "send_email", flaky)
    result = signed_in.post(f"/api/packages/{package['id']}/send").get_json()

    assert result["sent"] == ["ana@example.com"]
    assert result["failed"] == ["bob@example.com"]
    assert [p["sent"] for p in result["package"]["sends"][0]["recipients"]] == [True, False]


def test_the_public_page_of_a_package(signed_in, client):
    photo = uploaded(signed_in, app_name="photos", name="cat.png", content=PNG)
    doc = uploaded(signed_in, name="doc.txt", content=b"text")
    package = make(signed_in, name="Trip", file_ids=[photo["id"], doc["id"]], message="Enjoy")
    token = token_of(package)
    signed_in.post("/api/auth/logout")

    listing = client.get(f"/api/shared/{token}").get_json()
    assert listing["app"] == "package"
    assert listing["name"] == "Trip"
    assert listing["shared_by"] == "user@example.com"
    assert listing["message"] == "Enjoy"
    assert [f["name"] for f in listing["files"]] == ["cat.png", "doc.txt"]

    assert client.get(f"/api/shared/{token}/files/{doc['id']}").data == b"text"
    assert client.get(f"/api/shared/{token}/files/{photo['id']}/thumb").status_code == 200

    # A file that is not in the package is not reachable through its link
    client.post("/api/auth/login", json={"email": "user@example.com", "password": "correct horse"})
    other_file = uploaded(client, name="private.txt")
    client.post("/api/auth/logout")
    assert client.get(f"/api/shared/{token}/files/{other_file['id']}").status_code == 404


def test_the_link_expires_and_sending_renews_it(app, signed_in, outbox):
    file = uploaded(signed_in)
    ana = recipient(signed_in)
    package = make(signed_in, file_ids=[file["id"]], recipient_ids=[ana["id"]])
    token = token_of(package)
    assert package["expired"] is False

    row = db.session.get(Package, package["id"])
    row.expires_at = utcnow() - timedelta(days=1)
    db.session.commit()

    assert signed_in.get(f"/api/shared/{token}").status_code == 404
    assert signed_in.get(f"/api/packages/{package['id']}").get_json()["expired"] is True

    sent = signed_in.post(f"/api/packages/{package['id']}/send").get_json()
    assert sent["package"]["expired"] is False
    assert signed_in.get(f"/api/shared/{token}").status_code == 200


def test_deleting_a_package_stops_its_link_and_keeps_the_files(signed_in):
    file = uploaded(signed_in)
    package = make(signed_in, file_ids=[file["id"]])

    assert signed_in.delete(f"/api/packages/{package['id']}").status_code == 204
    assert signed_in.get(f"/api/shared/{token_of(package)}").status_code == 404
    assert signed_in.get("/api/packages").get_json()["items"] == []
    assert signed_in.get(f"/api/drive/files/{file['id']}/content").status_code == 200


def test_deleting_files_and_folders_for_good_takes_them_out_of_packages(signed_in):
    folder = new_folder(signed_in, "Work")
    uploaded(signed_in, name="inside.txt", folder_id=folder["id"])
    gone = uploaded(signed_in, name="gone.txt")
    kept = uploaded(signed_in, name="kept.txt")
    package = make(signed_in, file_ids=[gone["id"], kept["id"]], folder_ids=[folder["id"]])

    signed_in.delete(f"/api/drive/files/{gone['id']}?permanent=1")
    signed_in.delete(f"/api/drive/folders/{folder['id']}?permanent=1")

    after = signed_in.get(f"/api/packages/{package['id']}").get_json()
    assert [f["name"] for f in after["files"]] == ["kept.txt"]
    assert after["folders"] == []
    assert after["file_count"] == 1


def test_users_cannot_reach_each_others_packages(signed_in, other):
    file = uploaded(signed_in)
    package = make(signed_in, file_ids=[file["id"]])
    url = f"/api/packages/{package['id']}"

    assert other.get("/api/packages").get_json()["items"] == []
    assert other.get(url).status_code == 404
    assert other.patch(url, json={"name": "Mine now"}).status_code == 404
    assert other.post(f"{url}/send").status_code == 404
    assert other.delete(url).status_code == 404
    assert signed_in.get(url).get_json()["name"] == "For the board"
