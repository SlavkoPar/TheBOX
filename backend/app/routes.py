from flask import Blueprint, jsonify
from sqlalchemy import text

from .extensions import db

api = Blueprint("api", __name__)


@api.get("/health")
def health():
    try:
        db.session.execute(text("SELECT 1"))
        database = "ok"
    except Exception:
        database = "unavailable"
    return jsonify(status="ok", database=database)
