from .common import ApiError, Email, Str, crud_blueprint
from .extensions import db
from .models import Friend

SCHEMA = {
    "first_name": Str(required=True, max_len=100),
    "last_name": Str(max_len=100),
    "email": Email(required=True),
    "address": Str(max_len=255),
    "country": Str(max_len=100),
    "mobile": Str(max_len=40),
}


def _validate(friend):
    duplicate = db.session.scalar(
        db.select(Friend).where(
            Friend.user_id == friend.user_id,
            Friend.email == friend.email,
            Friend.id != (friend.id or 0),
        )
    )
    if duplicate is not None:
        raise ApiError("A friend with this email address already exists.", 409)


friends = crud_blueprint(
    "friends",
    Friend,
    SCHEMA,
    order_by=lambda: (Friend.first_name, Friend.last_name, Friend.id),
    validate=_validate,
    noun="Friend",
)
