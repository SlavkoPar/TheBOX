from flask import Blueprint, jsonify
from sqlalchemy import text

from .auth import current_user, login_required
from .extensions import db
from .models import utcnow

api = Blueprint("api", __name__)


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
