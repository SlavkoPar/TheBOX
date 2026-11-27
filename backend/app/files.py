"""Folders, files and sharing — one implementation used by both Drive and Photos.

`files_blueprint("drive")` and `files_blueprint("photos")` create the same set of
endpoints over the same tables; rows are kept apart by their `app` column.
The differences between the two apps are the entries in FILE_APP_OPTIONS.

Deleting moves an item to the trash (`deleted_at`); a folder in the trash takes
everything inside it along. Trashed items are invisible everywhere except the
trash endpoints, and are removed from the database only by a permanent delete.
"""

import mimetypes
import os
import secrets
from datetime import timedelta
from io import BytesIO
from urllib.parse import quote

from flask import Blueprint, current_app, jsonify, request, send_file

from . import crypto
from .auth import current_user, login_required
from .common import ApiError, Str, as_utc, get_owned, id_list, iso, json_body
from .extensions import db
from .imaging import THUMB_TYPE, describe_image
from .mail import send_email
from .models import File, Folder, Package, Friend, Share, utcnow
from .previews import PreviewError, build_preview

FILE_APP_OPTIONS = {
    "drive": {"label": "Drive", "noun": "document", "images_only": False, "encryption": True},
    "photos": {"label": "Photos", "noun": "photo", "images_only": True, "encryption": False},
}

NAME = Str(required=True, max_len=255, label="Name")
MIN_ENCRYPTION_PASSWORD = 8
SEARCH_LIMIT = 100

# Types a browser may display inside the app. Anything else is always sent as a
# download, so an uploaded HTML or SVG file can never run script on this origin.
INLINE_TYPES = {
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/avif",
    "application/pdf",
    "text/plain",
}
# Types the in-app editors can save: plain text, spreadsheets (CSV), rich text (HTML).
TEXT_TYPES = {"text/plain", "text/markdown", "text/csv", "text/html"}

# The platform's MIME table is not reliable for these (on Windows, .csv is
# reported as an Excel type), so they are decided here.
EXTENSION_TYPES = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".html": "text/html",
    ".htm": "text/html",
    ".webp": "image/webp",
    ".avif": "image/avif",
}


def guess_type(name, fallback=None):
    extension = os.path.splitext(name)[1].lower()
    return (
        EXTENSION_TYPES.get(extension)
        or mimetypes.guess_type(name)[0]
        or fallback
        or "application/octet-stream"
    )


# --- Helpers shared with the public share endpoints ----------------------------


def in_trash(folder):
    """True if this folder or any folder above it is in the trash."""
    while folder is not None:
        if folder.deleted_at is not None:
            return True
        folder = folder.parent
    return False


def is_active(file):
    return file.deleted_at is None and not in_trash(file.folder)


def path_of(folder):
    """'Work / Reports' for a folder; '' for the top level."""
    names = []
    while folder is not None:
        names.append(folder.name)
        folder = folder.parent
    return " / ".join(reversed(names))


def files_inside(folder):
    """Every file in a folder and its subfolders, skipping trashed ones."""
    found = [f for f in folder.files if f.deleted_at is None]
    for child in folder.children:
        if child.deleted_at is None:
            found += files_inside(child)
    return found


def package_entries(package):
    """Files a package gives access to, as (file, path) in display order.

    The files picked one by one have path ''. A folder is live: its entries are
    the files in it (and its subfolders) now, with the path from that folder
    down, e.g. 'Reports / 2024'.
    """
    entries = {file.id: (file, "") for file in package.files if is_active(file)}

    def walk(folder, path):
        for file in folder.files:
            if file.deleted_at is None:
                entries.setdefault(file.id, (file, path))
        for child in folder.children:
            if child.deleted_at is None:
                walk(child, f"{path} / {child.name}")

    for folder in package.folders:
        if not in_trash(folder):
            walk(folder, folder.name)
    return sorted(entries.values(), key=lambda e: (e[1].lower(), e[0].name.lower(), e[0].id))


def storage_used(user_id):
    """Bytes of file content the user stores, in every app, including the trash."""
    return db.session.scalar(
        db.select(db.func.coalesce(db.func.sum(File.size), 0)).where(File.user_id == user_id)
    )


def check_quota(user_id, incoming):
    quota = current_app.config["STORAGE_QUOTA_MB"] * 1024 * 1024
    if quota and storage_used(user_id) + incoming > quota:
        raise ApiError(
            "Not enough storage space. Delete files (and empty the trash) to make room.", 413
        )


def password_from(data):
    password = data.get("password")
    if not isinstance(password, str) or not password:
        raise ApiError("Password is required.")
    return password


def file_content(file, password=None):
    """Original content of a file, decrypting it if needed."""
    if not file.is_encrypted:
        return file.data
    if password is None:
        raise ApiError("This document is encrypted. Enter its password.", 403, "encrypted")
    try:
        return crypto.decrypt(file.data, password, file.enc_salt, file.enc_nonce)
    except crypto.WrongPassword:
        raise ApiError("Incorrect password.", 403, "wrong_password") from None


def send_content(file, content, download):
    inline = not download and file.mime_type in INLINE_TYPES
    mimetype = file.mime_type
    if mimetype.startswith("text/"):
        mimetype += "; charset=utf-8"
    response = send_file(BytesIO(content), mimetype=mimetype, max_age=0)
    disposition = "inline" if inline else "attachment"
    response.headers["Content-Disposition"] = (
        f"{disposition}; filename*=UTF-8''{quote(file.name, safe='')}"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Cache-Control"] = "private, no-store"
    return response


def send_thumb(file):
    """Small preview of an image; the image itself when no thumbnail was made."""
    if file.is_encrypted:
        raise ApiError("This document is encrypted. Enter its password.", 403, "encrypted")
    if file.thumb is None:
        return send_content(file, file.data, download=False)
    response = send_file(BytesIO(file.thumb), mimetype=THUMB_TYPE, max_age=0)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Cache-Control"] = "private, max-age=3600"
    return response


def set_content(file, content):
    """Store new content, refreshing size, thumbnail and image metadata."""
    file.data = content
    file.size = len(content)
    info = describe_image(content) if file.mime_type.startswith("image/") else {}
    file.thumb = info.get("thumb")
    file.width, file.height = info.get("width"), info.get("height")
    file.taken_at, file.camera = info.get("taken_at"), info.get("camera")


def wants_download():
    return request.args.get("download") in ("1", "true")


def _clean_filename(name):
    name = (name or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
    return NAME.parse("name", name)


def _like(text):
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


# --- Blueprint factory ---------------------------------------------------------


def files_blueprint(app_name):
    options = FILE_APP_OPTIONS[app_name]
    noun = options["noun"]
    bp = Blueprint(app_name, __name__)

    def get_folder(folder_id, *, trashed_ok=False):
        folder = get_owned(Folder, folder_id, "Folder not found.")
        if folder.app != app_name or (not trashed_ok and in_trash(folder)):
            raise ApiError("Folder not found.", 404)
        return folder

    def get_file(file_id, *, trashed_ok=False):
        file = get_owned(File, file_id, f"{noun.capitalize()} not found.")
        if file.app != app_name or (not trashed_ok and not is_active(file)):
            raise ApiError(f"{noun.capitalize()} not found.", 404)
        return file

    def optional_folder(value):
        """Folder for an id from the request; None / '' means the top level."""
        if value in (None, "", "root"):
            return None
        try:
            return get_folder(int(value))
        except (TypeError, ValueError):
            raise ApiError("Folder not found.", 404) from None

    def sibling_folder(name, parent, ignore_id=None):
        return db.session.scalar(
            db.select(Folder).where(
                Folder.user_id == current_user().id,
                Folder.app == app_name,
                Folder.deleted_at.is_(None),
                Folder.parent_id.is_(None) if parent is None else Folder.parent_id == parent.id,
                Folder.name == name,
                Folder.id != (ignore_id or 0),
            )
        )

    def check_folder_name_free(name, parent, ignore_id=None):
        if sibling_folder(name, parent, ignore_id) is not None:
            raise ApiError("A folder with this name already exists here.", 409)

    def require_encryption():
        if not options["encryption"]:
            raise ApiError(f"Encryption is not available in {options['label']}.", 400)

    def own(model):
        return db.select(model).where(model.user_id == current_user().id, model.app == app_name)

    # --- Browsing ---

    @bp.get("/items")
    @login_required
    def list_items():
        """Contents of one folder (or the top level), with the path leading to it."""
        folder = optional_folder(request.args.get("folder"))
        parent_filter = lambda col: col.is_(None) if folder is None else col == folder.id  # noqa: E731

        folders = db.session.scalars(
            own(Folder)
            .where(Folder.deleted_at.is_(None), parent_filter(Folder.parent_id))
            .order_by(db.func.lower(Folder.name), Folder.id)
        )
        files = db.session.scalars(
            own(File)
            .where(File.deleted_at.is_(None), parent_filter(File.folder_id))
            .order_by(db.func.lower(File.name), File.id)
        )

        breadcrumbs = []
        node = folder
        while node is not None:
            breadcrumbs.append({"id": node.id, "name": node.name})
            node = node.parent
        breadcrumbs.reverse()

        return jsonify(
            folder=folder.to_dict() if folder else None,
            breadcrumbs=breadcrumbs,
            folders=[f.to_dict() for f in folders],
            files=[f.to_dict() for f in files],
        )

    @bp.get("/folders")
    @login_required
    def list_folders():
        """Every folder, flat — for choosing where to move something."""
        folders = db.session.scalars(
            own(Folder).where(Folder.deleted_at.is_(None)).order_by(db.func.lower(Folder.name))
        )
        return jsonify(items=[f.to_dict() for f in folders if not in_trash(f)])

    @bp.get("/search")
    @login_required
    def search():
        """Files and folders whose name contains ?q=, in any folder."""
        text = (request.args.get("q") or "").strip()
        if not text:
            return jsonify(folders=[], files=[])
        pattern = _like(text)

        folders = db.session.scalars(
            own(Folder)
            .where(Folder.deleted_at.is_(None), Folder.name.ilike(pattern, escape="\\"))
            .order_by(db.func.lower(Folder.name))
            .limit(SEARCH_LIMIT)
        )
        files = db.session.scalars(
            own(File)
            .where(File.deleted_at.is_(None), File.name.ilike(pattern, escape="\\"))
            .order_by(db.func.lower(File.name))
            .limit(SEARCH_LIMIT)
        )
        return jsonify(
            folders=[
                {**f.to_dict(), "path": path_of(f.parent)} for f in folders if not in_trash(f)
            ],
            files=[{**f.to_dict(), "path": path_of(f.folder)} for f in files if is_active(f)],
        )

    # --- Folders ---

    @bp.post("/folders")
    @login_required
    def create_folder():
        data = json_body()
        name = NAME.parse("name", data.get("name"))
        parent = optional_folder(data.get("parent_id"))
        check_folder_name_free(name, parent)
        folder = Folder(
            user_id=current_user().id, app=app_name, name=name, parent_id=parent.id if parent else None
        )
        db.session.add(folder)
        db.session.commit()
        return jsonify(folder.to_dict()), 201

    @bp.patch("/folders/<int:folder_id>")
    @login_required
    def update_folder(folder_id):
        """Rename (`name`) and / or move (`parent_id`; null for the top level)."""
        folder = get_folder(folder_id)
        data = json_body()
        name = NAME.parse("name", data["name"]) if "name" in data else folder.name
        parent = optional_folder(data["parent_id"]) if "parent_id" in data else folder.parent

        node = parent
        while node is not None:
            if node.id == folder.id:
                raise ApiError("A folder cannot be moved into itself.")
            node = node.parent

        check_folder_name_free(name, parent, ignore_id=folder.id)
        folder.name = name
        folder.parent_id = parent.id if parent else None
        db.session.commit()
        return jsonify(folder.to_dict())

    @bp.delete("/folders/<int:folder_id>")
    @login_required
    def delete_folder(folder_id):
        """Move a folder to the trash; ?permanent=1 deletes it and its contents for good."""
        if request.args.get("permanent") in ("1", "true"):
            db.session.delete(get_folder(folder_id, trashed_ok=True))
        else:
            get_folder(folder_id).deleted_at = utcnow()
        db.session.commit()
        return "", 204

    # --- Files ---

    @bp.post("/files")
    @login_required
    def upload_files():
        """multipart/form-data: one or more `file` parts and an optional `folder_id`."""
        folder = optional_folder(request.form.get("folder_id"))
        uploads = [u for u in request.files.getlist("file") if u.filename]
        if not uploads:
            raise ApiError("Choose at least one file to upload.")

        created, total = [], 0
        for upload in uploads:
            name = _clean_filename(upload.filename)
            mime_type = guess_type(name, upload.mimetype)
            if options["images_only"] and not mime_type.startswith("image/"):
                raise ApiError(f"“{name}” is not an image. Photos accepts image files only.")
            content = upload.read()
            total += len(content)
            file = File(
                user_id=current_user().id,
                app=app_name,
                folder_id=folder.id if folder else None,
                name=name,
                mime_type=mime_type[:127],
            )
            set_content(file, content)
            created.append(file)

        check_quota(current_user().id, total)
        db.session.add_all(created)
        db.session.commit()
        return jsonify(files=[f.to_dict() for f in created]), 201

    @bp.patch("/files/<int:file_id>")
    @login_required
    def update_file(file_id):
        """Rename (`name`) and / or move (`folder_id`; null for the top level)."""
        file = get_file(file_id)
        data = json_body()
        if "name" in data:
            file.name = _clean_filename(data["name"])
        if "folder_id" in data:
            folder = optional_folder(data["folder_id"])
            file.folder_id = folder.id if folder else None
        db.session.commit()
        return jsonify(file.to_dict())

    @bp.delete("/files/<int:file_id>")
    @login_required
    def delete_file(file_id):
        """Move a file to the trash; ?permanent=1 deletes it for good."""
        if request.args.get("permanent") in ("1", "true"):
            db.session.delete(get_file(file_id, trashed_ok=True))
        else:
            get_file(file_id).deleted_at = utcnow()
        db.session.commit()
        return "", 204

    @bp.get("/files/<int:file_id>/content")
    @login_required
    def get_content(file_id):
        """View (inline) or, with ?download=1, download an unencrypted file."""
        file = get_file(file_id)
        return send_content(file, file_content(file), wants_download())

    @bp.post("/files/<int:file_id>/content")
    @login_required
    def get_encrypted_content(file_id):
        """Same as GET, with the password for an encrypted document in the body."""
        file = get_file(file_id)
        password = password_from(json_body()) if file.is_encrypted else None
        return send_content(file, file_content(file, password), wants_download())

    @bp.get("/files/<int:file_id>/thumb")
    @login_required
    def get_thumb(file_id):
        return send_thumb(get_file(file_id))

    @bp.get("/files/<int:file_id>/preview")
    @login_required
    def get_preview(file_id):
        """Text-only preview of a Word, Excel or PowerPoint file, as JSON."""
        file = get_file(file_id)
        try:
            return jsonify(build_preview(file.name, file_content(file)))
        except PreviewError as err:
            raise ApiError(str(err), 422) from None

    @bp.put("/files/<int:file_id>/text")
    @login_required
    def save_text(file_id):
        """Replace the content of a text document (the in-app editors)."""
        file = get_file(file_id)
        if file.mime_type not in TEXT_TYPES:
            raise ApiError("Only text documents can be edited.")
        if file.is_encrypted:
            raise ApiError("Decrypt this document before editing it.")
        content = json_body().get("content")
        if not isinstance(content, str):
            raise ApiError("Content must be text.")
        encoded = content.encode("utf-8")
        if len(encoded) > current_app.config["MAX_CONTENT_LENGTH"]:
            raise ApiError("The document is too large.", 413)
        check_quota(current_user().id, len(encoded) - file.size)
        file.data = encoded
        file.size = len(encoded)
        db.session.commit()
        return jsonify(file.to_dict())

    # --- Trash ---

    @bp.get("/trash")
    @login_required
    def list_trash():
        """Items that were deleted directly (not those inside a deleted folder)."""
        folders = db.session.scalars(
            own(Folder).where(Folder.deleted_at.is_not(None)).order_by(Folder.deleted_at.desc())
        )
        files = db.session.scalars(
            own(File).where(File.deleted_at.is_not(None)).order_by(File.deleted_at.desc())
        )
        return jsonify(
            folders=[{**f.to_dict(), "path": path_of(f.parent)} for f in folders],
            files=[{**f.to_dict(), "path": path_of(f.folder)} for f in files],
        )

    @bp.post("/trash/restore")
    @login_required
    def restore():
        """Put trashed items back. An item whose folder is gone returns to the top level."""
        data = json_body()
        folder_ids = id_list(data, "folder_ids", "Folders") if "folder_ids" in data else []
        file_ids = id_list(data, "file_ids", "Files") if "file_ids" in data else []

        for folder_id in folder_ids:
            folder = get_folder(folder_id, trashed_ok=True)
            folder.deleted_at = None
            if in_trash(folder.parent):
                folder.parent_id = None
            parent = db.session.get(Folder, folder.parent_id) if folder.parent_id else None
            base, counter = folder.name, 1
            while sibling_folder(folder.name, parent, ignore_id=folder.id) is not None:
                counter += 1
                suffix = " (restored)" if counter == 2 else f" (restored {counter - 1})"
                folder.name = f"{base[: 255 - len(suffix)]}{suffix}"
            db.session.flush()

        for file_id in file_ids:
            file = get_file(file_id, trashed_ok=True)
            file.deleted_at = None
            if in_trash(file.folder):
                file.folder_id = None

        db.session.commit()
        return "", 204

    @bp.delete("/trash")
    @login_required
    def empty_trash():
        """Permanently delete everything in the trash."""
        trashed = [
            *db.session.scalars(own(Folder).where(Folder.deleted_at.is_not(None))).all(),
            *db.session.scalars(own(File).where(File.deleted_at.is_not(None))).all(),
        ]
        for item in trashed:
            state = db.inspect(item)
            if state.deleted or state.detached:
                continue  # already removed along with a folder above it
            db.session.delete(item)
            db.session.flush()
        db.session.commit()
        return "", 204

    # --- Encryption (Drive) ---

    @bp.post("/files/<int:file_id>/encrypt")
    @login_required
    def encrypt_file(file_id):
        require_encryption()
        file = get_file(file_id)
        if file.is_encrypted:
            raise ApiError("This document is already encrypted.", 409)
        password = password_from(json_body())
        if len(password) < MIN_ENCRYPTION_PASSWORD:
            raise ApiError(f"Password must be at least {MIN_ENCRYPTION_PASSWORD} characters.")
        file.data, file.enc_salt, file.enc_nonce = crypto.encrypt(file.data, password)
        file.is_encrypted = True
        file.thumb = None  # a preview would give the content away
        db.session.commit()
        return jsonify(file.to_dict())

    @bp.post("/files/<int:file_id>/decrypt")
    @login_required
    def decrypt_file(file_id):
        """Permanently remove encryption, storing the original content again."""
        require_encryption()
        file = get_file(file_id)
        if not file.is_encrypted:
            raise ApiError("This document is not encrypted.", 409)
        content = file_content(file, password_from(json_body()))
        file.is_encrypted = False
        file.enc_salt = file.enc_nonce = None
        set_content(file, content)
        db.session.commit()
        return jsonify(file.to_dict())

    # --- Sharing ---

    @bp.post("/shares")
    @login_required
    def create_share():
        """Email the selected friends a link to view or download the selected files.

        `folder_ids` shares every file that is in those folders (and their
        subfolders) at this moment; files added later are not included.
        """
        data = json_body()
        file_ids = id_list(data, "file_ids", "Files") if "file_ids" in data else []
        folder_ids = id_list(data, "folder_ids", "Folders") if "folder_ids" in data else []
        friend_ids = id_list(data, "friend_ids", "Friends")
        message = Str(max_len=2000, label="Message").parse("message", data.get("message"))

        files = {file_id: get_file(file_id) for file_id in file_ids}
        for folder_id in folder_ids:
            for file in files_inside(get_folder(folder_id)):
                files.setdefault(file.id, file)
        if not files:
            if folder_ids:
                raise ApiError(f"The selected folders contain no {noun}s to share.")
            raise ApiError(f"Select at least one {noun} to share.")
        if not friend_ids:
            raise ApiError("Select at least one friend.")
        friends = [get_owned(Friend, rid, "Friend not found.") for rid in friend_ids]

        days = current_app.config["SHARE_MAX_AGE_DAYS"]
        share = Share(
            user_id=current_user().id,
            app=app_name,
            token=secrets.token_urlsafe(32),
            message=message,
            expires_at=utcnow() + timedelta(days=days) if days else None,
            files=list(files.values()),
            friends=friends,
        )
        db.session.add(share)
        db.session.commit()

        link = share_link(share)
        sent, failed = [], []
        for friend in friends:
            try:
                send_email(friend.email, *_share_email(share, friend, link, options))
                sent.append(friend.email)
            except Exception:
                current_app.logger.exception("Could not send share email to %s", friend.email)
                failed.append(friend.email)

        return jsonify(share=share_dict(share), link=link, sent=sent, failed=failed), 201

    @bp.get("/shares")
    @login_required
    def list_shares():
        shares = db.session.scalars(own(Share).order_by(Share.id.desc()))
        return jsonify(items=[share_dict(s) for s in shares])

    @bp.delete("/shares/<int:share_id>")
    @login_required
    def revoke_share(share_id):
        """Stop a link from working."""
        share = get_owned(Share, share_id, "Shared link not found.")
        if share.app != app_name:
            raise ApiError("Shared link not found.", 404)
        db.session.delete(share)
        db.session.commit()
        return "", 204

    return bp


def share_link(share):
    return f"{current_app.config['FRONTEND_URL']}/shared/{share.token}"


def share_dict(share):
    expired = bool(share.expires_at and as_utc(share.expires_at) < utcnow())
    return {
        **share.to_dict(),
        "files": [f.to_dict() for f in share.files if is_active(f)],
        "link": share_link(share),
        "expired": expired,
    }


def _share_email(share, friend, link, options):
    owner = share.owner.email
    count = len(share.files)
    noun = options["noun"] + ("" if count == 1 else "s")
    lines = [
        f"Hello {friend.first_name},",
        "",
        f"{owner} shared {count} {noun} with you on TheBOX:",
        "",
        *[f"  - {file.name}" for file in share.files],
        "",
    ]
    if share.message:
        lines += [share.message, ""]
    lines += [f"View or download: {link}", ""]
    if any(file.is_encrypted for file in share.files):
        lines += ["Encrypted documents need a password, which the sender will give you.", ""]
    if share.expires_at:
        lines += [f"The link works until {as_utc(share.expires_at):%d %B %Y}.", ""]
    subject = f"{owner} shared {count} {noun} with you"
    return subject, "\n".join(lines)


# --- Storage use, across both apps ----------------------------------------------

storage = Blueprint("storage", __name__)


@storage.get("")
@login_required
def storage_info():
    """Bytes used and the limit (0 = no limit)."""
    return jsonify(
        used=storage_used(current_user().id),
        quota=current_app.config["STORAGE_QUOTA_MB"] * 1024 * 1024,
    )


# --- Public endpoints for people who received a link (no sign-in) ----------------

shared = Blueprint("shared", __name__)


def _share_or_404(token):
    """The shared link or the package behind a token."""
    share = db.session.scalar(db.select(Share).where(Share.token == token)) or db.session.scalar(
        db.select(Package).where(Package.token == token)
    )
    if share is None or (share.expires_at and as_utc(share.expires_at) < utcnow()):
        raise ApiError("This link is not valid or has expired.", 404)
    return share


def _shared_entries(share):
    """(file, path) for every file the link gives access to."""
    if isinstance(share, Package):
        return package_entries(share)
    files = sorted(share.files, key=lambda f: f.name.lower())
    return [(file, "") for file in files if is_active(file)]


def _shared_file(token, file_id):
    for file, _ in _shared_entries(_share_or_404(token)):
        if file.id == file_id:
            return file
    raise ApiError("File not found.", 404)


@shared.get("/<token>")
def view_share(token):
    share = _share_or_404(token)
    is_package = isinstance(share, Package)
    return jsonify(
        # "package": files of both apps, some of them inside folders (`path`).
        app="package" if is_package else share.app,
        name=share.name if is_package else "",
        shared_by=share.owner.email,
        message=share.message,
        expires_at=iso(share.expires_at),
        files=[
            {
                "id": f.id,
                "name": f.name,
                "path": path,
                "mime_type": f.mime_type,
                "size": f.size,
                "is_encrypted": f.is_encrypted,
                "width": f.width,
                "height": f.height,
            }
            for f, path in _shared_entries(share)
        ],
    )


@shared.get("/<token>/files/<int:file_id>")
def shared_content(token, file_id):
    file = _shared_file(token, file_id)
    return send_content(file, file_content(file), wants_download())


@shared.post("/<token>/files/<int:file_id>")
def shared_encrypted_content(token, file_id):
    file = _shared_file(token, file_id)
    password = password_from(json_body()) if file.is_encrypted else None
    return send_content(file, file_content(file, password), wants_download())


@shared.get("/<token>/files/<int:file_id>/thumb")
def shared_thumb(token, file_id):
    return send_thumb(_shared_file(token, file_id))
