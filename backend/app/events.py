from zoneinfo import ZoneInfo

from .common import ApiError, Bool, DateTime, Int, Str, as_utc, crud_blueprint
from .extensions import db
from .models import Event

MAX_REMINDER_MINUTES = 60 * 24 * 28  # four weeks

SCHEMA = {
    "title": Str(required=True, max_len=255),
    "description": Str(max_len=5000),
    "location": Str(max_len=255),
    "starts_at": DateTime(required=True, label="Start"),
    "ends_at": DateTime(required=True, label="End"),
    "all_day": Bool(),
    "timezone": Str(max_len=64, default="UTC", label="Time zone"),
    # Minutes before the start to email a reminder; null for no reminder.
    "reminder_minutes": Int(min_value=0, max_value=MAX_REMINDER_MINUTES, label="Reminder"),
}


def _validate(event):
    if as_utc(event.ends_at) < as_utc(event.starts_at):
        raise ApiError("End must not be before start.")

    try:
        ZoneInfo(event.timezone)
    except Exception:
        raise ApiError("Time zone is not valid.") from None

    # If the start or the reminder changed, the reminder is due again.
    state = db.inspect(event)
    if (
        state.attrs.starts_at.history.has_changes()
        or state.attrs.reminder_minutes.history.has_changes()
    ):
        event.reminder_sent_at = None


events = crud_blueprint(
    "events",
    Event,
    SCHEMA,
    order_by=lambda: (Event.starts_at, Event.id),
    validate=_validate,
    noun="Event",
)
