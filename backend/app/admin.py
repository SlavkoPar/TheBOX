"""What only administrators may see.

An administrator is a confirmed user whose email address is listed in the
ADMIN_EMAILS setting. There is no admin flag in the database: changing the
setting (and restarting) is how admins are added and removed.
"""

from functools import wraps

from flask import Blueprint, jsonify

from .auth import current_user, login_required
from .common import ApiError, iso
from .extensions import db
from .models import File, User

admin = Blueprint("admin", __name__)


def admin_required(view):
    @wraps(view)
    @login_required
    def wrapped(*args, **kwargs):
        if not current_user().is_admin:
            raise ApiError("Only administrators can do this.", 403, "not_admin")
        return view(*args, **kwargs)

    return wrapped


@admin.get("/users")
@admin_required
def list_users():
    """Everyone who registered, newest first, with how much each one stores."""
    stored = (
        db.select(
            File.user_id,
            db.func.count(File.id).label("file_count"),
            db.func.coalesce(db.func.sum(File.size), 0).label("storage_used"),
        )
        .group_by(File.user_id)
        .subquery()
    )
    rows = db.session.execute(
        db.select(User, stored.c.file_count, stored.c.storage_used)
        .outerjoin(stored, stored.c.user_id == User.id)
        .order_by(User.created_at.desc(), User.id.desc())
    )
    return jsonify(
        items=[
            {
                **user.to_dict(),
                "created_at": iso(user.created_at),
                "confirmed_at": iso(user.confirmed_at),
                "file_count": file_count or 0,
                "storage_used": int(storage_used or 0),
            }
            for user, file_count, storage_used in rows
        ]
    )
