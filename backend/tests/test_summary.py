from test_admin import ADMIN_CREDS, sign_in
from test_files import new_folder, uploaded


def test_summary_requires_sign_in(client):
    assert client.get("/api/summary").status_code == 401


def test_summary_is_empty_for_a_new_user(signed_in):
    assert signed_in.get("/api/summary").get_json() == {
        "drive": {"folders": 0, "files": 0},
        "photos": {"folders": 0, "files": 0},
        "tasks": {"open": 0, "done": 0},
        "calendar": {"events": 0},
        "packages": {"packages": 0},
        "recipients": {"recipients": 0},
    }


def test_summary_counts_each_app_without_the_trash(signed_in, other):
    work = new_folder(signed_in, "Work")
    sub = new_folder(signed_in, "Sub", work["id"])
    old = new_folder(signed_in, "Old")
    new_folder(signed_in, "Inside old", old["id"])
    uploaded(signed_in, name="top.txt")
    uploaded(signed_in, name="deep.txt", folder_id=sub["id"])
    gone = uploaded(signed_in, name="gone.txt")
    uploaded(signed_in, name="in-old.txt", folder_id=old["id"])
    new_folder(signed_in, "Trip", app_name="photos")
    # To the trash: one file, and a folder with a file and a folder inside it
    assert signed_in.delete(f"/api/drive/files/{gone['id']}").status_code in (200, 204)
    assert signed_in.delete(f"/api/drive/folders/{old['id']}").status_code in (200, 204)

    first = signed_in.post("/api/tasks", json={"title": "One"}).get_json()
    signed_in.post("/api/tasks", json={"title": "Sub", "parent_id": first["id"]})
    done = signed_in.post("/api/tasks", json={"title": "Two"}).get_json()
    signed_in.patch(f"/api/tasks/{done['id']}", json={"is_done": True})
    signed_in.post(
        "/api/recipients", json={"first_name": "Ana", "email": "ana@example.com"}
    )

    # Someone else's things are not counted
    uploaded(other, name="theirs.txt")

    counts = signed_in.get("/api/summary").get_json()
    assert counts["drive"] == {"folders": 2, "files": 2}
    assert counts["photos"] == {"folders": 1, "files": 0}
    assert counts["tasks"] == {"open": 1, "done": 1}
    assert counts["recipients"] == {"recipients": 1}
    assert "users" not in counts


def test_summary_tells_an_admin_how_many_users_there_are(app, signed_in, outbox):
    admin = sign_in(app, outbox, ADMIN_CREDS)
    assert admin.get("/api/summary").get_json()["users"] == {"users": 2}
