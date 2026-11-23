"""Packages: a named set of files and folders, picked from any folder of Drive
and Photos, behind one link that is emailed to the package's recipients.

A package can be edited and sent again; every send is recorded, so the package
is also the history of what was sent to whom. The link opens the same public
page as a shared link (`files.shared`).
"""

import secrets
from datetime import timedelta

from flask import Blueprint, current_app, jsonify, request

from .auth import current_user, login_required
from .common import ApiError, Str, as_utc, get_owned, id_list, iso, json_body
from .extensions import db
from .files import files_inside, in_trash, is_active, package_entries, path_of, share_link
from .mail import send_email
from .models import File, Folder, Package, PackageSend, Recipient, utcnow

packages = Blueprint("packages", __name__)

NAME = Str(required=True, max_len=255, label="Name")
MESSAGE = Str(max_len=2000, label="Message")
NOT_FOUND = "Package not found."


def _file(file_id):
    file = get_owned(File, file_id, "File not found.")
    if not is_active(file):
        raise ApiError("File not found.", 404)
    return file


def _folder(folder_id):
    folder = get_owned(Folder, folder_id, "Folder not found.")
    if in_trash(folder):
        raise ApiError("Folder not found.", 404)
    return folder


def _expiry():
    days = current_app.config["SHARE_MAX_AGE_DAYS"]
    return utcnow() + timedelta(days=days) if days else None


def _ids(data, key, label):
    return id_list(data, key, label) if key in data else []


def _save(package, *, partial):
    """Validate the request and set it on the package. PATCH leaves out what was not sent."""
    data = json_body()
    wanted = lambda key: key in data or not partial  # noqa: E731
    with db.session.no_autoflush:
        if wanted("name"):
            package.name = NAME.parse("name", data.get("name"))
        if wanted("message"):
            package.message = MESSAGE.parse("message", data.get("message"))
        if wanted("file_ids"):
            package.files = [_file(i) for i in _ids(data, "file_ids", "Files")]
        if wanted("folder_ids"):
            package.folders = [_folder(i) for i in _ids(data, "folder_ids", "Folders")]
        if wanted("recipient_ids"):
            package.recipients = [
                get_owned(Recipient, i, "Recipient not found.")
                for i in _ids(data, "recipient_ids", "Recipients")
            ]
        if not package.files and not package.folders:
            raise ApiError("Add at least one file or folder to the package.")
    package.updated_at = utcnow()
    db.session.add(package)
    db.session.commit()
    return package


def _contents(package):
    """The folders and files picked for the package that still exist, in display order."""
    order = lambda item: (item.app, item.name.lower(), item.id)  # noqa: E731
    folders = sorted((f for f in package.folders if not in_trash(f)), key=order)
    files = sorted((f for f in package.files if is_active(f)), key=order)
    return folders, files


def _folder_item(folder):
    return {
        "app": folder.app,
        "name": folder.name,
        "path": path_of(folder.parent),
        "file_count": len(files_inside(folder)),
    }


def _file_item(file):
    return {"app": file.app, "name": file.name, "path": path_of(file.folder)}


def package_dict(package):
    folders, files = _contents(package)
    return {
        "id": package.id,
        "name": package.name,
        "message": package.message,
        "link": share_link(package),
        "created_at": iso(package.created_at),
        "updated_at": iso(package.updated_at),
        "expires_at": iso(package.expires_at),
        "expired": bool(package.expires_at and as_utc(package.expires_at) < utcnow()),
        # `path` is where the item is: "Work / Reports", or "" for the top level.
        "folders": [{**f.to_dict(), **_folder_item(f)} for f in folders],
        "files": [{**f.to_dict(), **_file_item(f)} for f in files],
        # Files the link gives access to: those picked plus those inside the folders.
        "file_count": len(package_entries(package)),
        "recipients": [r.to_dict() for r in package.recipients],
        "sends": [s.to_dict() for s in package.sends],
    }


@packages.get("")
@login_required
def list_packages():
    found = db.session.scalars(
        db.select(Package).where(Package.user_id == current_user().id).order_by(Package.id.desc())
    )
    return jsonify(items=[package_dict(p) for p in found])


@packages.post("")
@login_required
def create_package():
    package = Package(
        user_id=current_user().id, token=secrets.token_urlsafe(32), expires_at=_expiry()
    )
    return jsonify(package_dict(_save(package, partial=False))), 201


@packages.get("/<int:package_id>")
@login_required
def get_package(package_id):
    return jsonify(package_dict(get_owned(Package, package_id, NOT_FOUND)))


@packages.route("/<int:package_id>", methods=["PUT", "PATCH"])
@login_required
def update_package(package_id):
    """Change the name, message, contents or recipients. Nothing is emailed."""
    package = get_owned(Package, package_id, NOT_FOUND)
    return jsonify(package_dict(_save(package, partial=request.method == "PATCH")))


@packages.delete("/<int:package_id>")
@login_required
def delete_package(package_id):
    """Delete the package and its history; its link stops working."""
    db.session.delete(get_owned(Package, package_id, NOT_FOUND))
    db.session.commit()
    return "", 204


@packages.post("/<int:package_id>/send")
@login_required
def send_package(package_id):
    """Email the link to the package's recipients and record the send.

    Sending renews the link: it works for SHARE_MAX_AGE_DAYS from now.
    """
    package = get_owned(Package, package_id, NOT_FOUND)
    entries = package_entries(package)
    if not entries:
        raise ApiError("This package has no files to send.")
    if not package.recipients:
        raise ApiError("Add at least one recipient to the package.")

    package.expires_at = _expiry()
    link = share_link(package)
    folders, files = _contents(package)
    encrypted = any(file.is_encrypted for file, _ in entries)

    sent, failed, record = [], [], []
    for recipient in package.recipients:
        try:
            send_email(
                recipient.email,
                *_package_email(package, recipient, link, folders, files, len(entries), encrypted),
            )
            sent.append(recipient.email)
            ok = True
        except Exception:
            current_app.logger.exception("Could not send package email to %s", recipient.email)
            failed.append(recipient.email)
            ok = False
        record.append({"name": recipient.full_name, "email": recipient.email, "sent": ok})

    db.session.add(
        PackageSend(
            package=package,
            message=package.message,
            recipients=record,
            items=[
                *[{"kind": "folder", **_folder_item(f)} for f in folders],
                *[{"kind": "file", **_file_item(f)} for f in files],
            ],
        )
    )
    db.session.commit()
    return jsonify(package=package_dict(package), link=link, sent=sent, failed=failed)


def _package_email(package, recipient, link, folders, files, count, encrypted):
    owner = package.owner.email
    lines = [
        f"Hello {recipient.first_name},",
        "",
        f"{owner} sent you “{package.name}” on TheBOX ({count} file{'' if count == 1 else 's'}):",
        "",
        *[f"  - {folder.name} (folder)" for folder in folders],
        *[f"  - {file.name}" for file in files],
        "",
    ]
    if package.message:
        lines += [package.message, ""]
    lines += [f"View or download: {link}", ""]
    if encrypted:
        lines += ["Encrypted documents need a password, which the sender will give you.", ""]
    if package.expires_at:
        lines += [f"The link works until {as_utc(package.expires_at):%d %B %Y}.", ""]
    return f"{owner} sent you “{package.name}”", "\n".join(lines)
