from datetime import timezone
from zoneinfo import ZoneInfo

from flask import current_app

from .common import (
    ApiError,
    Bool,
    Choice,
    Date,
    DateTime,
    Int,
    Str,
    as_utc,
    crud_blueprint,
    id_list,
)
from .extensions import db
from .mail import send_email
from .models import EVENT_REPEATS, Event, Friend, User

MAX_REMINDER_MINUTES = 60 * 24 * 28  # four weeks

REPEAT_TEXT = {
    "daily": "every day",
    "weekly": "every week",
    "monthly": "every month",
    "yearly": "every year",
}

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
    "repeat": Choice(EVENT_REPEATS),
    "repeat_until": Date(label="Repeat until"),
}


def local_time(value, tz_name):
    """(datetime in the named zone, zone name), falling back to UTC."""
    try:
        return as_utc(value).astimezone(ZoneInfo(tz_name)), tz_name
    except Exception:
        return as_utc(value).astimezone(timezone.utc), "UTC"


def describe_when(event, start=None, end=None):
    """Human-readable time of an event (or of one occurrence of it)."""
    start, tz_name = local_time(start or event.starts_at, event.timezone)
    end, _ = local_time(end or event.ends_at, event.timezone)
    if event.all_day:
        return f"{start:%A, %d %B %Y} (all day)"
    if start.date() == end.date():
        return f"{start:%A, %d %B %Y, %H:%M}–{end:%H:%M} ({tz_name})"
    return f"{start:%A, %d %B %Y, %H:%M} – {end:%A, %d %B %Y, %H:%M} ({tz_name})"


def describe_repeat(event):
    if event.repeat == "none":
        return ""
    text = f"Repeats {REPEAT_TEXT[event.repeat]}"
    if event.repeat_until:
        text += f" until {event.repeat_until:%d %B %Y}"
    return text


def event_details(event, start=None, end=None):
    """Lines describing an event, shared by invitation and reminder emails."""
    lines = [f"When: {describe_when(event, start, end)}"]
    if event.repeat != "none":
        lines.append(describe_repeat(event))
    if event.location:
        lines.append(f"Where: {event.location}")
    if event.description:
        lines += ["", event.description]
    return lines


def _extra(event, data, partial):
    """`friend_ids`: the friends invited to the event."""
    before = {r.id for r in event.friends}
    if "friend_ids" in data:
        ids = id_list(data, "friend_ids", "Invited friends")
        invited = []
        for friend_id in ids:
            friend = db.session.get(Friend, friend_id)
            if friend is None or friend.user_id != event.user_id:
                raise ApiError("Friend not found.", 404)
            invited.append(friend)
        event.friends = invited
    elif not partial:
        event.friends = []
    # Remembered for after the commit: only newly invited people get the invitation.
    event._newly_invited = [r for r in event.friends if r.id not in before]


def _validate(event):
    if as_utc(event.ends_at) < as_utc(event.starts_at):
        raise ApiError("End must not be before start.")

    try:
        zone = ZoneInfo(event.timezone)
    except Exception:
        raise ApiError("Time zone is not valid.") from None

    if event.repeat == "none":
        event.repeat_until = None
    elif event.repeat_until and event.repeat_until < as_utc(event.starts_at).astimezone(zone).date():
        raise ApiError("Repeat until must not be before the start.")

    # If the schedule or the reminder changed, the reminder is due again.
    attrs = db.inspect(event).attrs
    if any(
        attrs[name].history.has_changes()
        for name in ("starts_at", "reminder_minutes", "repeat", "repeat_until")
    ):
        event.reminder_sent_at = None
        event.reminded_for = None


def _send_invitations(event):
    invited = getattr(event, "_newly_invited", [])
    if not invited:
        return
    owner = db.session.get(User, event.user_id).email
    subject = f"Invitation: {event.title} — {describe_when(event)}"
    for friend in invited:
        body = "\n".join(
            [
                f"Hello {friend.first_name},",
                "",
                f"{owner} invited you to: {event.title}",
                "",
                *event_details(event),
                "",
            ]
        )
        try:
            send_email(friend.email, subject, body)
        except Exception:
            current_app.logger.exception("Could not send invitation to %s", friend.email)


events = crud_blueprint(
    "events",
    Event,
    SCHEMA,
    order_by=lambda: (Event.starts_at, Event.id),
    validate=_validate,
    extra=_extra,
    after_commit=_send_invitations,
    noun="Event",
)
