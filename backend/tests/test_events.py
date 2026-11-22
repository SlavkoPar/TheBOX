from datetime import datetime, timedelta, timezone

import pytest

from app import reminders
from app.extensions import db
from app.models import Event

NOW = datetime(2026, 12, 1, 12, 0, tzinfo=timezone.utc)


def event_json(start=NOW + timedelta(hours=2), minutes=60, **extra):
    return {
        "title": "Team meeting",
        "starts_at": start.isoformat(),
        "ends_at": (start + timedelta(minutes=minutes)).isoformat(),
        **extra,
    }


# --- CRUD ---------------------------------------------------------------------


def test_requires_login(client):
    assert client.get("/api/events").status_code == 401


def test_create_and_defaults(signed_in):
    r = signed_in.post("/api/events", json=event_json())
    assert r.status_code == 201
    event = r.get_json()
    assert event["title"] == "Team meeting"
    assert event["all_day"] is False
    assert event["timezone"] == "UTC"
    assert event["reminder_minutes"] is None
    assert event["reminder_sent_at"] is None
    assert datetime.fromisoformat(event["starts_at"]) == NOW + timedelta(hours=2)


def test_times_are_converted_to_utc(signed_in):
    r = signed_in.post(
        "/api/events",
        json={"title": "x", "starts_at": "2026-12-01T10:00:00+02:00", "ends_at": "2026-12-01T11:00:00+02:00"},
    )
    assert r.get_json()["starts_at"] == "2026-12-01T08:00:00+00:00"


@pytest.mark.parametrize(
    "changes",
    [
        {"title": ""},
        {"starts_at": "not a date"},
        {"starts_at": None},
        {"ends_at": (NOW - timedelta(days=1)).isoformat()},
        {"reminder_minutes": -5},
        {"reminder_minutes": "10"},
        {"reminder_minutes": 60 * 24 * 365},
        {"timezone": "Mars/Olympus"},
        {"all_day": "yes"},
    ],
)
def test_validation(signed_in, changes):
    assert signed_in.post("/api/events", json={**event_json(), **changes}).status_code == 400
    assert signed_in.get("/api/events").get_json()["items"] == []


def test_update_delete_and_order(signed_in):
    later = signed_in.post("/api/events", json=event_json(NOW + timedelta(days=2), title="Later")).get_json()
    sooner = signed_in.post("/api/events", json=event_json(NOW + timedelta(days=1), title="Sooner")).get_json()
    assert [e["title"] for e in signed_in.get("/api/events").get_json()["items"]] == ["Sooner", "Later"]

    r = signed_in.patch(f"/api/events/{later['id']}", json={"location": "Room 2"})
    assert r.get_json()["location"] == "Room 2"
    assert r.get_json()["title"] == "Later"

    assert signed_in.delete(f"/api/events/{sooner['id']}").status_code == 204
    assert len(signed_in.get("/api/events").get_json()["items"]) == 1


def test_isolation(signed_in, other):
    event = signed_in.post("/api/events", json=event_json()).get_json()
    assert other.get("/api/events").get_json()["items"] == []
    assert other.get(f"/api/events/{event['id']}").status_code == 404
    assert other.delete(f"/api/events/{event['id']}").status_code == 404


# --- Reminders ------------------------------------------------------------------


def add_event(client, outbox, **kwargs):
    event = client.post("/api/events", json=event_json(**kwargs)).get_json()
    outbox.clear()
    return event


def test_reminder_sent_once_when_due(signed_in, outbox):
    add_event(signed_in, outbox, start=NOW + timedelta(minutes=30), reminder_minutes=30, location="Room 1")

    assert reminders.send_due_reminders(NOW - timedelta(minutes=1)) == 0  # one minute too early
    assert outbox == []

    assert reminders.send_due_reminders(NOW) == 1
    to, subject, body = outbox[0]
    assert to == "user@example.com"
    assert "Team meeting" in subject
    assert "Where: Room 1" in body
    assert "http://frontend.test/calendar" in body

    assert reminders.send_due_reminders(NOW + timedelta(minutes=5)) == 0  # not sent twice
    assert len(outbox) == 1


def test_no_reminder_without_setting_or_after_start(signed_in, outbox):
    add_event(signed_in, outbox, start=NOW + timedelta(minutes=10))  # no reminder set
    add_event(signed_in, outbox, start=NOW - timedelta(minutes=1), reminder_minutes=30)  # already started
    assert reminders.send_due_reminders(NOW) == 0
    assert outbox == []


def test_reminder_sent_late_if_a_run_was_missed(signed_in, outbox):
    # Due 20 minutes ago (server was down); the event has not started yet.
    add_event(signed_in, outbox, start=NOW + timedelta(minutes=10), reminder_minutes=30)
    assert reminders.send_due_reminders(NOW) == 1


def test_reminder_goes_to_the_events_owner(signed_in, other, outbox):
    add_event(other, outbox, start=NOW + timedelta(minutes=10), reminder_minutes=15)
    assert reminders.send_due_reminders(NOW) == 1
    assert outbox[0][0] == "other@example.com"


def test_changing_start_or_reminder_makes_it_due_again(signed_in, outbox):
    event = add_event(signed_in, outbox, start=NOW + timedelta(minutes=30), reminder_minutes=30)
    assert reminders.send_due_reminders(NOW) == 1

    # Unrelated edit: stays sent
    signed_in.patch(f"/api/events/{event['id']}", json={"location": "Elsewhere"})
    assert reminders.send_due_reminders(NOW) == 0

    # Moved to tomorrow: reminder is pending again
    moved = signed_in.patch(
        f"/api/events/{event['id']}", json=event_json(NOW + timedelta(days=1))
    ).get_json()
    assert moved["reminder_sent_at"] is None
    assert reminders.send_due_reminders(NOW) == 0
    assert reminders.send_due_reminders(NOW + timedelta(days=1) - timedelta(minutes=30)) == 1
    assert len(outbox) == 2


def test_failed_send_is_retried(signed_in, outbox, monkeypatch):
    add_event(signed_in, outbox, start=NOW + timedelta(minutes=30), reminder_minutes=30)

    def boom(*args):
        raise OSError("smtp down")

    monkeypatch.setattr(reminders, "send_email", boom)
    assert reminders.send_due_reminders(NOW) == 0
    assert db.session.scalar(db.select(Event)).reminder_sent_at is None

    monkeypatch.setattr(reminders, "send_email", lambda *args: outbox.append(args))
    assert reminders.send_due_reminders(NOW) == 1


def test_email_uses_the_events_time_zone(signed_in, outbox):
    add_event(
        signed_in,
        outbox,
        start=datetime(2026, 12, 1, 14, 0, tzinfo=timezone.utc),
        reminder_minutes=60,
        timezone="Europe/Belgrade",
    )
    reminders.send_due_reminders(datetime(2026, 12, 1, 13, 0, tzinfo=timezone.utc))
    assert "15:00–16:00 (Europe/Belgrade)" in outbox[0][2]


def test_all_day_event_email(signed_in, outbox):
    add_event(signed_in, outbox, start=NOW + timedelta(hours=12), minutes=60 * 24, reminder_minutes=60 * 24, all_day=True)
    reminders.send_due_reminders(NOW)
    assert "(all day)" in outbox[0][2]


@pytest.mark.parametrize(
    "minutes, text",
    [(1, "1 minute"), (30, "30 minutes"), (60, "1 hour"), (120, "2 hours"), (90, "90 minutes"),
     (1440, "1 day"), (2880, "2 days"), (10080, "1 week")],
)
def test_describe_minutes(minutes, text):
    assert reminders.describe_minutes(minutes) == text


def test_cli_command(app, signed_in, outbox):
    result = app.test_cli_runner().invoke(args=["send-reminders"])
    assert result.exit_code == 0
    assert "Sent 0 reminder(s)." in result.output
