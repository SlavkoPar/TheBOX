from flask import Blueprint, jsonify
from sqlalchemy import text

from .auth import current_user, login_required
from .extensions import db
from .messenger import unread_count
from .models import Event, File, Folder, Package, Recipient, Task, User, utcnow

api = Blueprint("api", __name__)


def _count(model, *where):
    return db.session.scalar(db.select(db.func.count(model.id)).where(*where))


def _file_counts(user_id):
    """Folders and files per app, leaving out the trash and everything inside trashed folders."""
    folders = db.session.execute(
        db.select(Folder.id, Folder.parent_id, Folder.app, Folder.deleted_at).where(
            Folder.user_id == user_id
        )
    ).all()
    by_id = {folder.id: folder for folder in folders}
    live = {}

    def is_live(folder_id):
        if folder_id is None:
            return True
        if folder_id not in live:
            folder = by_id.get(folder_id)
            live[folder_id] = (
                folder is not None and folder.deleted_at is None and is_live(folder.parent_id)
            )
        return live[folder_id]

    counts = {app: {"folders": 0, "files": 0} for app in ("drive", "photos")}
    for folder in folders:
        if folder.app in counts and is_live(folder.id):
            counts[folder.app]["folders"] += 1
    # Grouped by folder, so the file contents are never loaded.
    grouped = db.session.execute(
        db.select(File.app, File.folder_id, db.func.count(File.id))
        .where(File.user_id == user_id, File.deleted_at.is_(None))
        .group_by(File.app, File.folder_id)
    )
    for app, folder_id, number in grouped:
        if app in counts and is_live(folder_id):
            counts[app]["files"] += number
    return counts


@api.get("/summary")
@login_required
def summary():
    """How many items the signed-in user has in each app, for the home page."""
    user = current_user()
    mine = lambda model: model.user_id == user.id  # noqa: E731
    top_task = (mine(Task), Task.parent_id.is_(None))
    result = {
        **_file_counts(user.id),
        "tasks": {
            "open": _count(Task, *top_task, Task.is_done.is_(False)),
            "done": _count(Task, *top_task, Task.is_done.is_(True)),
        },
        "calendar": {"events": _count(Event, mine(Event))},
        "packages": {"packages": _count(Package, mine(Package))},
        "recipients": {"recipients": _count(Recipient, mine(Recipient))},
        "messenger": {"unread": unread_count(user)},
    }
    if user.is_admin:
        result["users"] = {"users": _count(User)}
    return jsonify(result)


@api.get("/health")
def health():
    try:
        db.session.execute(text("SELECT 1"))
        database = "ok"
    except Exception:
        database = "unavailable"
    return jsonify(status="ok", database=database)


DEMO_ITEMS = [
    {"id": 1, "name": "Cardboard box", "size": "small"},
    {"id": 2, "name": "Wooden crate", "size": "medium"},
    {"id": 3, "name": "Shipping container", "size": "large"},
]


@api.get("/demo")
@login_required
def demo():
    """Sample data for the frontend's demo fetch. Requires a signed-in user."""
    return jsonify(
        message=f"Hello, {current_user().email}!",
        server_time=utcnow().isoformat(),
        items=DEMO_ITEMS,
    )
