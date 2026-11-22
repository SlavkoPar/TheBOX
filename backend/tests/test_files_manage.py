"""Move, search, trash, storage limit, sharing folders, thumbnails, previews, editors."""

from io import BytesIO

import pytest
from PIL import Image

from app import files as files_module
from app import imaging, previews
from app.extensions import db
from app.models import File, Folder
from test_files import PNG, items, new_folder, recipient, share, upload, uploaded


@pytest.fixture
def user(signed_in, outbox):
    outbox.clear()
    return signed_in


def names(listing, key="files"):
    return [entry["name"] for entry in listing[key]]


def image_bytes(size=(800, 600), fmt="JPEG", color=(200, 120, 40), exif=None, mode="RGB"):
    out = BytesIO()
    Image.new(mode, size, color).save(out, fmt, **({"exif": exif} if exif else {}))
    return out.getvalue()


# --- Move ----------------------------------------------------------------------------


def test_move_file_between_folders(user):
    work, archive = new_folder(user, "Work"), new_folder(user, "Archive")
    file = uploaded(user, name="a.txt", folder_id=work["id"])

    r = user.patch(f"/api/drive/files/{file['id']}", json={"folder_id": archive["id"]})
    assert r.status_code == 200
    assert r.get_json()["folder_id"] == archive["id"]
    assert names(items(user, work["id"])) == []
    assert names(items(user, archive["id"])) == ["a.txt"]

    user.patch(f"/api/drive/files/{file['id']}", json={"folder_id": None})  # to the top level
    assert names(items(user)) == ["a.txt"]

    assert user.patch(f"/api/drive/files/{file['id']}", json={"folder_id": 9999}).status_code == 404


def test_move_folder_with_its_contents(user):
    work, archive = new_folder(user, "Work"), new_folder(user, "Archive")
    reports = new_folder(user, "Reports", work["id"])
    uploaded(user, name="q4.txt", folder_id=reports["id"])

    r = user.patch(f"/api/drive/folders/{reports['id']}", json={"parent_id": archive["id"]})
    assert r.status_code == 200
    assert names(items(user, work["id"]), "folders") == []
    assert names(items(user, archive["id"]), "folders") == ["Reports"]
    inside = items(user, reports["id"])
    assert names(inside) == ["q4.txt"]
    assert [b["name"] for b in inside["breadcrumbs"]] == ["Archive", "Reports"]


def test_folder_cannot_move_into_itself_or_onto_a_same_named_folder(user):
    work = new_folder(user, "Work")
    sub = new_folder(user, "Sub", work["id"])
    deep = new_folder(user, "Deep", sub["id"])
    new_folder(user, "Sub")  # a top-level folder with the same name

    for target in (work["id"], sub["id"], deep["id"]):
        r = user.patch(f"/api/drive/folders/{work['id']}", json={"parent_id": target})
        assert r.status_code == 400, target
    assert user.patch(f"/api/drive/folders/{sub['id']}", json={"parent_id": None}).status_code == 409


def test_cannot_move_across_apps_or_users(user, other):
    album = new_folder(user, "Album", app_name="photos")
    file = uploaded(user, name="a.txt")
    assert user.patch(f"/api/drive/files/{file['id']}", json={"folder_id": album["id"]}).status_code == 404

    theirs = new_folder(other, "Theirs")
    assert user.patch(f"/api/drive/files/{file['id']}", json={"folder_id": theirs["id"]}).status_code == 404
    assert other.patch(f"/api/drive/files/{file['id']}", json={"folder_id": None}).status_code == 404


def test_folder_list_for_the_move_dialog(user):
    work = new_folder(user, "Work")
    new_folder(user, "Reports", work["id"])
    gone = new_folder(user, "Gone")
    new_folder(user, "Inside gone", gone["id"])
    user.delete(f"/api/drive/folders/{gone['id']}")

    listed = user.get("/api/drive/folders").get_json()["items"]
    assert sorted(f["name"] for f in listed) == ["Reports", "Work"]


# --- Search ---------------------------------------------------------------------------


def test_search_finds_names_in_any_folder(user, other):
    work = new_folder(user, "Work")
    reports = new_folder(user, "Annual reports", work["id"])
    uploaded(user, name="Report Q4.txt", folder_id=reports["id"])
    uploaded(user, name="notes.txt")
    uploaded(other, name="their report.txt")
    uploaded(user, app_name="photos", name="report-photo.png", content=PNG)

    found = user.get("/api/drive/search?q=REPORT").get_json()
    assert names(found) == ["Report Q4.txt"]
    assert found["files"][0]["path"] == "Work / Annual reports"
    assert names(found, "folders") == ["Annual reports"]
    assert found["folders"][0]["path"] == "Work"

    assert user.get("/api/drive/search?q=").get_json() == {"folders": [], "files": []}
    assert user.get("/api/drive/search?q=zzz").get_json() == {"folders": [], "files": []}


def test_search_treats_wildcards_literally(user):
    uploaded(user, name="100% done.txt")
    uploaded(user, name="1000 done.txt")
    uploaded(user, name="a_b.txt")
    uploaded(user, name="axb.txt")
    assert names(user.get("/api/drive/search?q=100%25").get_json()) == ["100% done.txt"]
    assert names(user.get("/api/drive/search?q=a_b").get_json()) == ["a_b.txt"]


# --- Trash ----------------------------------------------------------------------------


def test_deleted_file_goes_to_trash_and_can_be_restored(user):
    work = new_folder(user, "Work")
    file = uploaded(user, name="a.txt", content=b"AAA", folder_id=work["id"])

    assert user.delete(f"/api/drive/files/{file['id']}").status_code == 204
    assert names(items(user, work["id"])) == []
    assert user.get(f"/api/drive/files/{file['id']}/content").status_code == 404
    assert names(user.get("/api/drive/search?q=a.txt").get_json()) == []

    trash = user.get("/api/drive/trash").get_json()
    assert names(trash) == ["a.txt"]
    assert trash["files"][0]["path"] == "Work"
    assert trash["files"][0]["deleted_at"] is not None

    assert user.post("/api/drive/trash/restore", json={"file_ids": [file["id"]]}).status_code == 204
    assert names(items(user, work["id"])) == ["a.txt"]
    assert user.get(f"/api/drive/files/{file['id']}/content").data == b"AAA"
    assert user.get("/api/drive/trash").get_json() == {"folders": [], "files": []}


def test_deleted_folder_hides_and_restores_everything_inside(user):
    work = new_folder(user, "Work")
    sub = new_folder(user, "Sub", work["id"])
    file = uploaded(user, name="deep.txt", folder_id=sub["id"])

    assert user.delete(f"/api/drive/folders/{work['id']}").status_code == 204
    assert names(items(user), "folders") == []
    for url in (f"/api/drive/items?folder={work['id']}", f"/api/drive/items?folder={sub['id']}"):
        assert user.get(url).status_code == 404
    assert user.get(f"/api/drive/files/{file['id']}/content").status_code == 404
    assert upload(user, folder_id=sub["id"]).status_code == 404

    trash = user.get("/api/drive/trash").get_json()
    assert names(trash, "folders") == ["Work"]  # only what was deleted directly
    assert trash["files"] == []

    user.post("/api/drive/trash/restore", json={"folder_ids": [work["id"]]})
    assert names(items(user, sub["id"])) == ["deep.txt"]
    assert user.get(f"/api/drive/files/{file['id']}/content").status_code == 200


def test_restore_when_the_original_place_is_gone_or_taken(user):
    work = new_folder(user, "Work")
    file = uploaded(user, name="a.txt", folder_id=work["id"])
    user.delete(f"/api/drive/files/{file['id']}")
    user.delete(f"/api/drive/folders/{work['id']}")

    # The file's folder is in the trash: the file comes back at the top level
    user.post("/api/drive/trash/restore", json={"file_ids": [file["id"]]})
    assert names(items(user)) == ["a.txt"]

    # Meanwhile a new folder took the old name: the restored one is renamed
    new_folder(user, "Work")
    user.post("/api/drive/trash/restore", json={"folder_ids": [work["id"]]})
    assert sorted(names(items(user), "folders")) == ["Work", "Work (restored)"]


def test_a_trashed_name_does_not_block_a_new_folder(user):
    work = new_folder(user, "Work")
    user.delete(f"/api/drive/folders/{work['id']}")
    new_folder(user, "Work")


def test_permanent_delete_and_empty_trash(user):
    work = new_folder(user, "Work")
    sub = new_folder(user, "Sub", work["id"])
    inside = uploaded(user, name="inside.txt", folder_id=sub["id"])
    loose = uploaded(user, name="loose.txt")
    keep = uploaded(user, name="keep.txt")

    # Trash the inner folder first, then its parent: both are "deleted directly"
    user.delete(f"/api/drive/folders/{sub['id']}")
    user.delete(f"/api/drive/folders/{work['id']}")
    user.delete(f"/api/drive/files/{loose['id']}")
    assert user.delete(f"/api/drive/files/{loose['id']}?permanent=1").status_code == 204
    assert db.session.get(File, loose["id"]) is None

    assert user.delete("/api/drive/trash").status_code == 204
    assert db.session.scalars(db.select(Folder)).all() == []
    assert [f.id for f in db.session.scalars(db.select(File))] == [keep["id"]]
    assert db.session.get(File, inside["id"]) is None


def test_trash_is_per_app_and_per_user(user, other):
    mine = uploaded(user, name="mine.txt")
    photo = uploaded(user, app_name="photos", name="cat.png", content=PNG)
    user.delete(f"/api/drive/files/{mine['id']}")
    user.delete(f"/api/photos/files/{photo['id']}")

    assert names(user.get("/api/drive/trash").get_json()) == ["mine.txt"]
    assert names(user.get("/api/photos/trash").get_json()) == ["cat.png"]
    assert other.get("/api/drive/trash").get_json() == {"folders": [], "files": []}
    assert other.post("/api/drive/trash/restore", json={"file_ids": [mine["id"]]}).status_code == 404
    assert other.delete(f"/api/drive/files/{mine['id']}?permanent=1").status_code == 404

    other.delete("/api/drive/trash")
    user.delete("/api/photos/trash")
    assert db.session.get(File, mine["id"]) is not None
    assert db.session.get(File, photo["id"]) is None


def test_trashed_files_disappear_from_shared_links(app, user, outbox):
    a, b = uploaded(user, name="a.txt"), uploaded(user, name="b.txt")
    token = share(user, [a["id"], b["id"]], [recipient(user)["id"]]).get_json()["share"]["token"]
    visitor = app.test_client()

    user.delete(f"/api/drive/files/{a['id']}")
    assert names(visitor.get(f"/api/shared/{token}").get_json()) == ["b.txt"]
    assert visitor.get(f"/api/shared/{token}/files/{a['id']}").status_code == 404

    user.post("/api/drive/trash/restore", json={"file_ids": [a["id"]]})
    assert names(visitor.get(f"/api/shared/{token}").get_json()) == ["a.txt", "b.txt"]


# --- Storage limit ----------------------------------------------------------------------


def test_storage_use_and_limit(app, user):
    app.config["STORAGE_QUOTA_MB"] = 1
    assert user.get("/api/storage").get_json() == {"used": 0, "quota": 1024 * 1024}

    assert upload(user, name="big.bin", content=b"x" * 700_000).status_code == 201
    uploaded(user, app_name="photos", name="cat.png", content=PNG)
    assert user.get("/api/storage").get_json()["used"] == 700_000 + len(PNG)

    r = upload(user, name="more.bin", content=b"x" * 400_000)
    assert r.status_code == 413
    assert "storage" in r.get_json()["error"]
    assert names(items(user)) == ["big.bin"]

    # The trash still counts; deleting for good frees the space
    big = items(user)["files"][0]
    user.delete(f"/api/drive/files/{big['id']}")
    assert upload(user, name="more.bin", content=b"x" * 400_000).status_code == 413
    user.delete("/api/drive/trash")
    assert upload(user, name="more.bin", content=b"x" * 400_000).status_code == 201


def test_storage_is_per_user_and_can_be_unlimited(app, user, other):
    app.config["STORAGE_QUOTA_MB"] = 1
    upload(user, name="big.bin", content=b"x" * 900_000)
    assert upload(other, name="big.bin", content=b"x" * 900_000).status_code == 201
    assert other.get("/api/storage").get_json()["used"] == 900_000

    app.config["STORAGE_QUOTA_MB"] = 0
    assert upload(user, name="more.bin", content=b"x" * 900_000).status_code == 201
    assert user.get("/api/storage").get_json()["quota"] == 0
    assert app.test_client().get("/api/storage").status_code == 401


def test_editing_text_counts_against_the_limit(app, user):
    app.config["STORAGE_QUOTA_MB"] = 1
    file = uploaded(user, name="notes.txt", content=b"small")
    r = user.put(f"/api/drive/files/{file['id']}/text", json={"content": "x" * 2_000_000})
    assert r.status_code == 413
    assert user.put(f"/api/drive/files/{file['id']}/text", json={"content": "fits"}).status_code == 200


# --- Sharing folders, and the list of shared links ------------------------------------------


def test_sharing_a_folder_shares_the_files_inside_it(app, user, outbox):
    work = new_folder(user, "Work")
    sub = new_folder(user, "Sub", work["id"])
    gone = new_folder(user, "Gone", work["id"])
    uploaded(user, name="a.txt", folder_id=work["id"])
    uploaded(user, name="b.txt", folder_id=sub["id"])
    trashed = uploaded(user, name="trashed.txt", folder_id=work["id"])
    uploaded(user, name="in-gone.txt", folder_id=gone["id"])
    loose = uploaded(user, name="loose.txt")
    user.delete(f"/api/drive/files/{trashed['id']}")
    user.delete(f"/api/drive/folders/{gone['id']}")

    r = user.post(
        "/api/drive/shares",
        json={"folder_ids": [work["id"]], "file_ids": [loose["id"]], "recipient_ids": [recipient(user)["id"]]},
    )
    assert r.status_code == 201
    listing = app.test_client().get(f"/api/shared/{r.get_json()['share']['token']}").get_json()
    assert names(listing) == ["a.txt", "b.txt", "loose.txt"]
    assert "shared 3 documents" in outbox[-1][1]

    # A file added to the folder later is not part of the link
    uploaded(user, name="later.txt", folder_id=work["id"])
    listing = app.test_client().get(f"/api/shared/{r.get_json()['share']['token']}").get_json()
    assert "later.txt" not in names(listing)


def test_sharing_an_empty_folder_is_refused(user, outbox):
    empty = new_folder(user, "Empty")
    r = user.post("/api/drive/shares", json={"folder_ids": [empty["id"]], "recipient_ids": [recipient(user)["id"]]})
    assert r.status_code == 400
    assert "contain no documents" in r.get_json()["error"]
    assert outbox == []


def test_shared_links_list_shows_link_files_recipients_and_expiry(app, user, outbox):
    a = uploaded(user, name="a.txt")
    ana = recipient(user)
    created = share(user, [a["id"]], [ana["id"]], message="hi").get_json()

    (listed,) = user.get("/api/drive/shares").get_json()["items"]
    assert listed["link"] == created["link"]
    assert listed["expired"] is False
    assert names(listed) == ["a.txt"]
    assert [r["email"] for r in listed["recipients"]] == ["ana@example.com"]
    assert user.get("/api/photos/shares").get_json()["items"] == []

    user.delete(f"/api/drive/files/{a['id']}")
    assert user.get("/api/drive/shares").get_json()["items"][0]["files"] == []


# --- Thumbnails and photo metadata ------------------------------------------------------------


def test_photo_upload_makes_a_thumbnail_and_records_its_size(user):
    photo = uploaded(user, app_name="photos", name="wide.jpg", content=image_bytes((2000, 1000)))
    assert (photo["width"], photo["height"]) == (2000, 1000)

    r = user.get(f"/api/photos/files/{photo['id']}/thumb")
    assert r.status_code == 200
    assert r.mimetype == "image/webp"
    thumb = Image.open(BytesIO(r.data))
    assert thumb.size == (480, 240)
    assert len(r.data) < len(user.get(f"/api/photos/files/{photo['id']}/content").data)


def test_exif_date_camera_and_orientation(user):
    exif = Image.Exif()
    exif[271], exif[272] = "Canon", "Canon EOS 80D"
    exif[274] = 6  # camera held sideways
    exif.get_ifd(0x8769)[36867] = "2026:07:14 18:30:05"
    photo = uploaded(user, app_name="photos", name="p.jpg", content=image_bytes((1200, 800), exif=exif))

    assert photo["taken_at"] == "2026-07-14T18:30:05"
    assert photo["camera"] == "Canon EOS 80D"  # maker not repeated
    assert (photo["width"], photo["height"]) == (800, 1200)  # as displayed
    thumb = Image.open(BytesIO(user.get(f"/api/photos/files/{photo['id']}/thumb").data))
    assert thumb.size == (320, 480)


def test_transparent_png_keeps_transparency_in_thumbnail(user):
    content = image_bytes((600, 600), "PNG", (0, 0, 0, 0), mode="RGBA")
    photo = uploaded(user, app_name="photos", name="clear.png", content=content)
    thumb = Image.open(BytesIO(user.get(f"/api/photos/files/{photo['id']}/thumb").data))
    assert thumb.mode == "RGBA"
    assert thumb.getpixel((10, 10))[3] == 0


def test_unreadable_image_is_stored_without_thumbnail(user):
    photo = uploaded(user, app_name="photos", name="broken.png", content=PNG)  # header only
    assert photo["width"] is None
    r = user.get(f"/api/photos/files/{photo['id']}/thumb")
    assert r.status_code == 200
    assert r.data == PNG  # falls back to the file itself
    assert imaging.describe_image(b"not an image at all") == {}


def test_thumbnail_access_rules(app, user, other, outbox):
    photo = uploaded(user, app_name="photos", name="p.jpg", content=image_bytes())
    assert other.get(f"/api/photos/files/{photo['id']}/thumb").status_code == 404
    assert app.test_client().get(f"/api/photos/files/{photo['id']}/thumb").status_code == 401

    token = share(user, [photo["id"]], [recipient(user)["id"]], app_name="photos").get_json()["share"]["token"]
    visitor = app.test_client()
    assert visitor.get(f"/api/shared/{token}/files/{photo['id']}/thumb").mimetype == "image/webp"
    assert visitor.get(f"/api/shared/{token}").get_json()["files"][0]["width"] == 800
    assert visitor.get(f"/api/shared/wrong/files/{photo['id']}/thumb").status_code == 404


def test_encrypting_an_image_removes_its_thumbnail(user):
    image = uploaded(user, name="scan.jpg", content=image_bytes())
    user.post(f"/api/drive/files/{image['id']}/encrypt", json={"password": "open sesame"})
    assert db.session.get(File, image["id"]).thumb is None
    assert user.get(f"/api/drive/files/{image['id']}/thumb").status_code == 403

    user.post(f"/api/drive/files/{image['id']}/decrypt", json={"password": "open sesame"})
    assert user.get(f"/api/drive/files/{image['id']}/thumb").mimetype == "image/webp"


# --- Previews of Office files ---------------------------------------------------------------------


def docx_bytes():
    import docx

    document = docx.Document()
    document.add_heading("Quarterly report", level=1)
    document.add_paragraph("Sales grew by 12%.")
    document.add_paragraph("First point", style="List Bullet")
    table = document.add_table(rows=2, cols=2)
    for row, values in zip(table.rows, (("Region", "Sales"), ("North", "120"))):
        for cell, value in zip(row.cells, values):
            cell.text = value
    out = BytesIO()
    document.save(out)
    return out.getvalue()


def xlsx_bytes():
    import openpyxl

    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "Budget"
    sheet.append(["Item", "Cost"])
    sheet.append(["Rent", 1200])
    sheet.append(["Food", 350.5])
    workbook.create_sheet("Empty")
    out = BytesIO()
    workbook.save(out)
    return out.getvalue()


def pptx_bytes():
    from pptx import Presentation

    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[1])
    slide.shapes.title.text = "Roadmap"
    slide.placeholders[1].text = "Launch in March"
    out = BytesIO()
    presentation.save(out)
    return out.getvalue()


def test_preview_word_document(user):
    file = uploaded(user, name="report.docx", content=docx_bytes())
    preview = user.get(f"/api/drive/files/{file['id']}/preview").get_json()
    assert preview["kind"] == "document"
    assert preview["blocks"][:3] == [
        {"type": "heading", "level": 1, "text": "Quarterly report"},
        {"type": "paragraph", "text": "Sales grew by 12%."},
        {"type": "list-item", "text": "First point"},
    ]
    assert preview["blocks"][3] == {"type": "table", "rows": [["Region", "Sales"], ["North", "120"]]}


def test_preview_spreadsheet(user):
    file = uploaded(user, name="budget.xlsx", content=xlsx_bytes())
    preview = user.get(f"/api/drive/files/{file['id']}/preview").get_json()
    assert preview["kind"] == "sheets"
    assert preview["sheets"][0] == {
        "name": "Budget",
        "rows": [["Item", "Cost"], ["Rent", "1200"], ["Food", "350.5"]],
    }
    assert preview["sheets"][1] == {"name": "Empty", "rows": []}


def test_preview_presentation(user):
    file = uploaded(user, name="plan.pptx", content=pptx_bytes())
    preview = user.get(f"/api/drive/files/{file['id']}/preview").get_json()
    assert preview == {
        "kind": "slides",
        "slides": [{"title": "Roadmap", "lines": ["Launch in March"]}],
        "truncated": False,
    }


def test_preview_errors(user, other):
    text = uploaded(user, name="notes.txt")
    assert user.get(f"/api/drive/files/{text['id']}/preview").status_code == 422

    broken = uploaded(user, name="broken.docx", content=b"this is not a zip file")
    r = user.get(f"/api/drive/files/{broken['id']}/preview")
    assert r.status_code == 422
    assert "could not be read" in r.get_json()["error"]

    real = uploaded(user, name="report.docx", content=docx_bytes())
    assert other.get(f"/api/drive/files/{real['id']}/preview").status_code == 404
    user.post(f"/api/drive/files/{real['id']}/encrypt", json={"password": "open sesame"})
    assert user.get(f"/api/drive/files/{real['id']}/preview").status_code == 403


def test_preview_refuses_zip_bombs(monkeypatch):
    monkeypatch.setattr(previews, "MAX_UNPACKED", 100)
    with pytest.raises(previews.PreviewError, match="too large"):
        previews.build_preview("report.docx", docx_bytes())


# --- Rich text and spreadsheet documents ---------------------------------------------------------------


def test_html_and_csv_documents_are_editable_but_never_displayed_by_the_server(user):
    page = uploaded(user, name="letter.html", content=b"<p>Hello</p>")
    sheet = uploaded(user, name="table.csv", content=b"a,b\n1,2\n")
    assert page["mime_type"] == "text/html"
    assert sheet["mime_type"] == "text/csv"

    r = user.put(f"/api/drive/files/{page['id']}/text", json={"content": "<p>Hello <b>there</b></p>"})
    assert r.status_code == 200
    r = user.get(f"/api/drive/files/{page['id']}/content")
    assert r.data == b"<p>Hello <b>there</b></p>"
    # HTML is only ever handed out as a download, so it cannot run on the app's origin
    assert r.headers["Content-Disposition"].startswith("attachment")

    assert user.put(f"/api/drive/files/{sheet['id']}/text", json={"content": "a,b\n3,4\n"}).status_code == 200
    assert user.get(f"/api/drive/files/{sheet['id']}/content").data == b"a,b\n3,4\n"


@pytest.mark.parametrize(
    "name, expected",
    [
        ("a.csv", "text/csv"),
        ("a.CSV", "text/csv"),
        ("a.md", "text/markdown"),
        ("a.html", "text/html"),
        ("a.webp", "image/webp"),
        ("a.pdf", "application/pdf"),
        ("a.unknownext", "application/octet-stream"),
        ("no-extension", "application/octet-stream"),
    ],
)
def test_type_is_decided_from_the_extension(name, expected):
    assert files_module.guess_type(name) == expected


def test_type_falls_back_to_what_the_browser_said():
    assert files_module.guess_type("no-extension", "image/png") == "image/png"
