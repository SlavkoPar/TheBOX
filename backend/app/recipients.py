from .common import ApiError, Email, Str, crud_blueprint
from .extensions import db
from .models import Recipient

SCHEMA = {
    "first_name": Str(required=True, max_len=100),
    "last_name": Str(max_len=100),
    "email": Email(required=True),
    "address": Str(max_len=255),
    "country": Str(max_len=100),
    "mobile": Str(max_len=40),
}


def _validate(recipient):
    duplicate = db.session.scalar(
        db.select(Recipient).where(
            Recipient.user_id == recipient.user_id,
            Recipient.email == recipient.email,
            Recipient.id != (recipient.id or 0),
        )
    )
    if duplicate is not None:
        raise ApiError("A recipient with this email address already exists.", 409)


recipients = crud_blueprint(
    "recipients",
    Recipient,
    SCHEMA,
    order_by=lambda: (Recipient.first_name, Recipient.last_name, Recipient.id),
    validate=_validate,
    noun="Recipient",
)
