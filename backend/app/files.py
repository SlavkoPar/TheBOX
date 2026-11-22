"""Folders, files and sharing — one implementation used by both Drive and Photos.

`files_blueprint("drive")` and `files_blueprint("photos")` create the same set of
endpoints over the same tables; rows are kept apart by their `app` column.
The differences between the two apps are the entries in FILE_APP_OPTIONS.
"""

import mimetypes
import secrets
from datetime import timedelta
from io import BytesIO
from urllib.parse import quote

from flask import Blueprint, current_app, jsonify, request, send_file

from . import crypto
from .auth import current_user, login_required
from .common import ApiError, Str, as_utc, get_owned, json_body
from .extensions import db
from .mail import send_email
from .models import File, Folder, Recipient, Share, utcnow

FILE_APP_OPTIONS = {
    "drive": {"label": "Drive", "noun": "document", "images_only": False, "encryption": True},
    "photos": {"label": "Photos", "noun": "photo", "images_only": True, "encryption": False},
}

NAME = Str(required=True, max_len=255, label="Name")
MIN_ENCRYPTION_PASSWORD = 8

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
TEXT_TYPES = {"text/plain", "text/markdown", "text/csv"}

# Not every platform's MIME table knows these.
mimetypes.add_type("text/markdown", ".md")
mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("image/avif", ".avif")


# --- Helpers shared with the public share endpoints ----------------------------


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


def wants_download():
    return request.args.get("download") in ("1", "true")


def _clean_filename(name):
    name = (name or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
    return NAME.parse("name", name)


def _int_list(data, key, label):
    values = data.get(key)
    if not isinstance(values, list) or not all(
        isinstance(v, int) and not isinstance(v, bool) for v in values
    ):
        raise ApiError(f"{label} must be a list of ids.")
    return list(dict.fromkeys(values))


# --- Blueprint factory ---------------------------------------------------------


def files_blueprint(app_name):
    options = FILE_APP_OPTIONS[app_name]
    noun = options["noun"]
    bp = Blueprint(app_name, __name__)

    def get_folder(folder_id):
        folder = get_owned(Folder, folder_id, "Folder not found.")
        if folder.app != app_name:
            raise ApiError("Folder not found.", 404)
        return folder

    def get_file(file_id):
        file = get_owned(File, file_id, f"{noun.capitalize()} not found.")
        if file.app != app_name:
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

    def check_folder_name_free(name, parent, ignore_id=None):
        clash = db.session.scalar(
            db.select(Folder).where(
                Folder.user_id == current_user().id,
                Folder.app == app_name,
                Folder.parent_id.is_(None) if parent is None else Folder.parent_id == parent.id,
                Folder.name == name,
                Folder.id != (ignore_id or 0),
            )
        )
        if clash is not None:
            raise ApiError("A folder with this name already exists here.", 409)

    def require_encryption():
        if not options["encryption"]:
            raise ApiError(f"Encryption is not available in {options['label']}.", 400)

    # --- Browsing ---

    @bp.get("/items")
    @login_required
    def list_items():
        """Contents of one folder (or the top level), with the path leading to it."""
        folder = optional_folder(request.args.get("folder"))
        user_id = current_user().id
        parent_filter = lambda col: col.is_(None) if folder is None else col == folder.id  # noqa: E731

        folders = db.session.scalars(
            db.select(Folder)
            .where(Folder.user_id == user_id, Folder.app == app_name, parent_filter(Folder.parent_id))
            .order_by(db.func.lower(Folder.name), Folder.id)
        )
        files = db.session.scalars(
            db.select(File)
            .where(File.user_id == user_id, File.app == app_name, parent_filter(File.folder_id))
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
    def rename_folder(folder_id):
        folder = get_folder(folder_id)
        name = NAME.parse("name", json_body().get("name"))
        check_folder_name_free(name, folder.parent, ignore_id=folder.id)
        folder.name = name
        db.session.commit()
        return jsonify(folder.to_dict())

    @bp.delete("/folders/<int:folder_id>")
    @login_required
    def delete_folder(folder_id):
        """Delete a folder with everything inside it."""
        db.session.delete(get_folder(folder_id))
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

        created = []
        for upload in uploads:
            name = _clean_filename(upload.filename)
            mime_type = (
                mimetypes.guess_type(name)[0] or upload.mimetype or "application/octet-stream"
            )
            if options["images_only"] and not mime_type.startswith("image/"):
                raise ApiError(f"“{name}” is not an image. Photos accepts image files only.")
            content = upload.read()
            file = File(
                user_id=current_user().id,
                app=app_name,
                folder_id=folder.id if folder else None,
                name=name,
                mime_type=mime_type[:127],
                size=len(content),
                data=content,
            )
            db.session.add(file)
            created.append(file)
        db.session.commit()
        return jsonify(files=[f.to_dict() for f in created]), 201

    @bp.patch("/files/<int:file_id>")
    @login_required
    def rename_file(file_id):
        file = get_file(file_id)
        file.name = _clean_filename(json_body().get("name"))
        db.session.commit()
        return jsonify(file.to_dict())

    @bp.delete("/files/<int:file_id>")
    @login_required
    def delete_file(file_id):
        db.session.delete(get_file(file_id))
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

    @bp.put("/files/<int:file_id>/text")
    @login_required
    def save_text(file_id):
        """Replace the content of a text document (the in-app editor)."""
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
        file.data = encoded
        file.size = len(encoded)
        db.session.commit()
        return jsonify(file.to_dict())

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
        file.data = file_content(file, password_from(json_body()))
        file.is_encrypted = False
        file.enc_salt = file.enc_nonce = None
        db.session.commit()
        return jsonify(file.to_dict())

    # --- Sharing ---

    @bp.post("/shares")
    @login_required
    def create_share():
        """Email the selected recipients a link to view or download the selected files."""
        data = json_body()
        file_ids = _int_list(data, "file_ids", "Files")
        recipient_ids = _int_list(data, "recipient_ids", "Recipients")
        message = Str(max_len=2000, label="Message").parse("message", data.get("message"))
        if not file_ids:
            raise ApiError(f"Select at least one {noun} to share.")
        if not recipient_ids:
            raise ApiError("Select at least one recipient.")

        files = [get_file(file_id) for file_id in file_ids]
        recipients = [get_owned(Recipient, rid, "Recipient not found.") for rid in recipient_ids]

        days = current_app.config["SHARE_MAX_AGE_DAYS"]
        share = Share(
            user_id=current_user().id,
            app=app_name,
            token=secrets.token_urlsafe(32),
            message=message,
            expires_at=utcnow() + timedelta(days=days) if days else None,
            files=files,
            recipients=recipients,
        )
        db.session.add(share)
        db.session.commit()

        link = f"{current_app.config['FRONTEND_URL']}/shared/{share.token}"
        sent, failed = [], []
        for recipient in recipients:
            try:
                send_email(recipient.email, *_share_email(share, recipient, link, options))
                sent.append(recipient.email)
            except Exception:
                current_app.logger.exception("Could not send share email to %s", recipient.email)
                failed.append(recipient.email)

        return jsonify(share=share.to_dict(), link=link, sent=sent, failed=failed), 201

    @bp.get("/shares")
    @login_required
    def list_shares():
        shares = db.session.scalars(
            db.select(Share)
            .where(Share.user_id == current_user().id, Share.app == app_name)
            .order_by(Share.id.desc())
        )
        return jsonify(items=[s.to_dict() for s in shares])

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


def _share_email(share, recipient, link, options):
    owner = share.owner.email
    count = len(share.files)
    noun = options["noun"] + ("" if count == 1 else "s")
    lines = [
        f"Hello {recipient.first_name},",
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


# --- Public endpoints for people who received a link (no sign-in) ----------------

shared = Blueprint("shared", __name__)


def _share_or_404(token):
    share = db.session.scalar(db.select(Share).where(Share.token == token))
    if share is None or (share.expires_at and as_utc(share.expires_at) < utcnow()):
        raise ApiError("This link is not valid or has expired.", 404)
    return share


def _shared_file(token, file_id):
    share = _share_or_404(token)
    for file in share.files:
        if file.id == file_id:
            return file
    raise ApiError("File not found.", 404)


@shared.get("/<token>")
def view_share(token):
    share = _share_or_404(token)
    return jsonify(
        app=share.app,
        shared_by=share.owner.email,
        message=share.message,
        expires_at=share.to_dict()["expires_at"],
        files=[
            {
                "id": f.id,
                "name": f.name,
                "mime_type": f.mime_type,
                "size": f.size,
                "is_encrypted": f.is_encrypted,
            }
            for f in sorted(share.files, key=lambda f: f.name.lower())
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
