"""Code shared by all apps (Recipients, Tasks, Calendar, Drive, Photos).

- ApiError: raise anywhere in a view to return a JSON error.
- Field classes + apply_schema: validate request JSON and copy it onto a model.
- get_owned: load a row that belongs to the signed-in user, or 404.
- crud_blueprint: list / create / read / update / delete endpoints for a model.
"""

import re
from datetime import date, datetime, timezone

from flask import Blueprint, jsonify, request
from sqlalchemy.exc import IntegrityError

from .auth import current_user, login_required
from .extensions import db
from .models import iso  # noqa: F401  (re-exported for the app modules)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class ApiError(Exception):
    def __init__(self, message, status=400, code=None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code

    def to_response(self):
        body = {"error": self.message}
        if self.code:
            body["code"] = self.code
        return jsonify(body), self.status


def json_body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError("Request body must be a JSON object.")
    return data


def as_utc(value):
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def get_owned(model, object_id, message="Not found."):
    """Row of `model` with this id that belongs to the signed-in user, else 404."""
    obj = db.session.get(model, object_id) if isinstance(object_id, int) else None
    if obj is None or obj.user_id != current_user().id:
        raise ApiError(message, 404)
    return obj


# --- Fields -----------------------------------------------------------------


class Field:
    def __init__(self, *, required=False, default=None, label=None):
        self.required = required
        self.default = default
        self.label = label

    def name(self, key):
        return self.label or key.replace("_", " ").capitalize()

    def missing(self, key):
        if self.required:
            raise ApiError(f"{self.name(key)} is required.")
        return self.default

    def parse(self, key, value):
        raise NotImplementedError


class Str(Field):
    def __init__(self, *, max_len=255, **kwargs):
        kwargs.setdefault("default", "")
        super().__init__(**kwargs)
        self.max_len = max_len

    def parse(self, key, value):
        if value is None:
            value = ""
        if not isinstance(value, str):
            raise ApiError(f"{self.name(key)} must be text.")
        value = value.strip()
        if not value:
            return self.missing(key)
        if len(value) > self.max_len:
            raise ApiError(f"{self.name(key)} must be at most {self.max_len} characters.")
        return value


class Email(Str):
    def __init__(self, **kwargs):
        kwargs.setdefault("max_len", 254)
        super().__init__(**kwargs)

    def parse(self, key, value):
        value = super().parse(key, value)
        if value:
            value = value.lower()
            if not EMAIL_RE.match(value):
                raise ApiError(f"{self.name(key)} must be a valid email address.")
        return value


class Bool(Field):
    def __init__(self, **kwargs):
        kwargs.setdefault("default", False)
        super().__init__(**kwargs)

    def parse(self, key, value):
        if not isinstance(value, bool):
            raise ApiError(f"{self.name(key)} must be true or false.")
        return value


class Int(Field):
    def __init__(self, *, min_value=None, max_value=None, **kwargs):
        super().__init__(**kwargs)
        self.min_value = min_value
        self.max_value = max_value

    def parse(self, key, value):
        if value is None:
            return self.missing(key)
        if isinstance(value, bool) or not isinstance(value, int):
            raise ApiError(f"{self.name(key)} must be a whole number.")
        if self.min_value is not None and value < self.min_value:
            raise ApiError(f"{self.name(key)} must be at least {self.min_value}.")
        if self.max_value is not None and value > self.max_value:
            raise ApiError(f"{self.name(key)} must be at most {self.max_value}.")
        return value


class Date(Field):
    def parse(self, key, value):
        if value is None or value == "":
            return self.missing(key)
        try:
            return date.fromisoformat(value)
        except (TypeError, ValueError):
            raise ApiError(f"{self.name(key)} must be a date (YYYY-MM-DD).") from None


class DateTime(Field):
    """ISO 8601 date-time; stored in UTC. A value without an offset is taken as UTC."""

    def parse(self, key, value):
        if value is None or value == "":
            return self.missing(key)
        try:
            parsed = datetime.fromisoformat(value)
        except (TypeError, ValueError):
            raise ApiError(f"{self.name(key)} must be a date and time.") from None
        return as_utc(parsed).astimezone(timezone.utc)


def apply_schema(schema, data, obj, *, partial=False):
    """Validate `data` against `schema` and set the values on `obj`.

    With partial=True (PATCH) keys missing from `data` are left unchanged.
    """
    for key, field in schema.items():
        if key in data:
            value = field.parse(key, data[key])
        elif partial:
            continue
        else:
            value = field.missing(key)
        setattr(obj, key, value)
    return obj


# --- CRUD -------------------------------------------------------------------


def crud_blueprint(name, model, schema, *, order_by, validate=None, noun="Item"):
    """Blueprint with the standard endpoints for a model owned by a user.

    GET /            list the user's rows
    POST /           create
    GET /<id>        read
    PUT /<id>        replace (all fields validated)
    PATCH /<id>      update only the fields sent
    DELETE /<id>     delete

    `validate(obj)` may raise ApiError for rules that span several fields.
    """
    bp = Blueprint(name, __name__)
    not_found = f"{noun} not found."

    def save(obj, partial):
        # no_autoflush: validation queries must see the database as it is, not
        # trigger a write of the half-validated object.
        with db.session.no_autoflush:
            apply_schema(schema, json_body(), obj, partial=partial)
            if validate:
                validate(obj)
        db.session.add(obj)
        try:
            db.session.commit()
        except IntegrityError:
            # A concurrent request got there first (e.g. the same unique value).
            raise ApiError(f"This {noun.lower()} conflicts with an existing one.", 409) from None
        return obj

    @bp.get("")
    @login_required
    def list_items():
        query = db.select(model).where(model.user_id == current_user().id).order_by(*order_by())
        return jsonify(items=[obj.to_dict() for obj in db.session.scalars(query)])

    @bp.post("")
    @login_required
    def create_item():
        obj = save(model(user_id=current_user().id), partial=False)
        return jsonify(obj.to_dict()), 201

    @bp.get("/<int:item_id>")
    @login_required
    def get_item(item_id):
        return jsonify(get_owned(model, item_id, not_found).to_dict())

    @bp.route("/<int:item_id>", methods=["PUT", "PATCH"])
    @login_required
    def update_item(item_id):
        obj = get_owned(model, item_id, not_found)
        return jsonify(save(obj, partial=request.method == "PATCH").to_dict())

    @bp.delete("/<int:item_id>")
    @login_required
    def delete_item(item_id):
        db.session.delete(get_owned(model, item_id, not_found))
        db.session.commit()
        return "", 204

    return bp
