"""Email reminders some time before a calendar event starts.

`send_due_reminders()` finds events whose reminder time has arrived and emails
the event's owner. It is run:
  - by a background thread in the web process, every REMINDER_INTERVAL_SECONDS;
  - or on demand / from cron with `flask send-reminders`.

Several processes may run it at once (gunicorn workers, the debug reloader):
each reminder is claimed with a conditional UPDATE, so it is sent only once.
"""

import threading
from datetime import timedelta
from zoneinfo import ZoneInfo

import click
from flask import current_app

from .common import as_utc
from .events import MAX_REMINDER_MINUTES
from .extensions import db
from .mail import send_email
from .models import Event, User, utcnow


def describe_minutes(minutes):
    for size, unit in ((60 * 24 * 7, "week"), (60 * 24, "day"), (60, "hour")):
        if minutes >= size and minutes % size == 0:
            count = minutes // size
            return f"{count} {unit}{'' if count == 1 else 's'}"
    return f"{minutes} minute{'' if minutes == 1 else 's'}"


def _local(value, tz_name):
    try:
        return as_utc(value).astimezone(ZoneInfo(tz_name)), tz_name
    except Exception:
        return as_utc(value), "UTC"


def reminder_email(event):
    start, tz_name = _local(event.starts_at, event.timezone)
    end, _ = _local(event.ends_at, event.timezone)
    if event.all_day:
        when = f"{start:%A, %d %B %Y} (all day)"
    elif start.date() == end.date():
        when = f"{start:%A, %d %B %Y, %H:%M}–{end:%H:%M} ({tz_name})"
    else:
        when = f"{start:%A, %d %B %Y, %H:%M} – {end:%A, %d %B %Y, %H:%M} ({tz_name})"

    lines = [f"Reminder: {event.title}", "", f"When: {when}"]
    if event.location:
        lines.append(f"Where: {event.location}")
    if event.description:
        lines += ["", event.description]
    lines += ["", f"Open your calendar: {current_app.config['FRONTEND_URL']}/calendar", ""]
    return f"Reminder: {event.title} — {when}", "\n".join(lines)


def send_due_reminders(now=None):
    """Send every reminder that is due. Returns the number of emails sent."""
    now = now or utcnow()
    candidates = db.session.scalars(
        db.select(Event).where(
            Event.reminder_minutes.is_not(None),
            Event.reminder_sent_at.is_(None),
            Event.starts_at > now,  # never remind about an event that already started
            Event.starts_at <= now + timedelta(minutes=MAX_REMINDER_MINUTES),
        )
    ).all()

    sent = 0
    for event in candidates:
        if as_utc(event.starts_at) - timedelta(minutes=event.reminder_minutes) > now:
            continue  # not due yet

        # Claim it: only one process gets rowcount == 1.
        claimed = db.session.execute(
            db.update(Event)
            .where(Event.id == event.id, Event.reminder_sent_at.is_(None))
            .values(reminder_sent_at=now)
        )
        db.session.commit()
        if claimed.rowcount != 1:
            continue

        owner = db.session.get(User, event.user_id)
        try:
            send_email(owner.email, *reminder_email(event))
            sent += 1
        except Exception:
            current_app.logger.exception("Could not send reminder for event %s", event.id)
            # Release the claim so the next run tries again.
            db.session.execute(
                db.update(Event).where(Event.id == event.id).values(reminder_sent_at=None)
            )
            db.session.commit()
    return sent


def start_scheduler(app):
    """Run send_due_reminders periodically in a daemon thread."""
    interval = app.config["REMINDER_INTERVAL_SECONDS"]
    stop = threading.Event()

    def loop():
        # Wait first: lets short-lived CLI commands (e.g. `flask db upgrade`) finish
        # before the first query, and the tables exist by then.
        while not stop.wait(interval):
            with app.app_context():
                try:
                    send_due_reminders()
                except Exception:
                    app.logger.exception("Reminder run failed")
                finally:
                    db.session.remove()

    thread = threading.Thread(target=loop, name="reminders", daemon=True)
    thread.start()
    app.extensions["reminder_scheduler"] = (thread, stop)
    return thread


def register_cli(app):
    @app.cli.command("send-reminders")
    def send_reminders_command():
        """Send calendar reminder emails that are due now."""
        click.echo(f"Sent {send_due_reminders()} reminder(s).")
