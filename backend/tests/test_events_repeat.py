"""Repeating events, invited friends, and their reminders."""

from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app import events as events_module
from app import reminders
from app.recurrence import next_occurrence, occurrence, shift

UTC = timezone.utc
START = datetime(2026, 12, 1, 9, 0, tzinfo=UTC)  # a Tuesday


def event_json(start=START, minutes=60, **extra):
    return {
        "title": "Stand-up",
        "starts_at": start.isoformat(),
        "ends_at": (start + timedelta(minutes=minutes)).isoformat(),
        **extra,
    }


def create(client, outbox=None, **kwargs):
    r = client.post("/api/events", json=event_json(**kwargs))
    assert r.status_code == 201, r.get_json()
    if outbox is not None:
        outbox.clear()
    return r.get_json()


def friend(client, email="ana@example.com", first_name="Ana"):
    return client.post("/api/friends", json={"first_name": first_name, "email": email}).get_json()


def fake_event(repeat, start=START, until=None, tz="UTC", minutes=60):
    return SimpleNamespace(
        starts_at=start, ends_at=start + timedelta(minutes=minutes), repeat=repeat, repeat_until=until, timezone=tz
    )


# --- Recurrence arithmetic -----------------------------------------------------------


@pytest.mark.parametrize(
    "day, repeat, n, expected",
    [
        (date(2026, 12, 30), "daily", 3, date(2027, 1, 2)),
        (date(2026, 12, 1), "weekly", 2, date(2026, 12, 15)),
        (date(2026, 1, 31), "monthly", 1, date(2026, 2, 28)),
        (date(2026, 1, 31), "monthly", 2, date(2026, 3, 31)),  # the clamp does not stick
        (date(2026, 11, 15), "monthly", 3, date(2027, 2, 15)),
        (date(2024, 2, 29), "yearly", 1, date(2025, 2, 28)),
        (date(2024, 2, 29), "yearly", 4, date(2028, 2, 29)),
        (date(2026, 5, 5), "none", 7, date(2026, 5, 5)),
    ],
)
def test_shift(day, repeat, n, expected):
    assert shift(day, repeat, n) == expected


def test_next_occurrence_of_a_single_event():
    event = fake_event("none")
    assert next_occurrence(event, START - timedelta(minutes=1)) == (START, START + timedelta(hours=1))
    assert next_occurrence(event, START) is None


@pytest.mark.parametrize(
    "repeat, after, expected_start",
    [
        ("daily", datetime(2026, 12, 1, 8, 0, tzinfo=UTC), datetime(2026, 12, 1, 9, 0, tzinfo=UTC)),
        ("daily", datetime(2026, 12, 1, 9, 0, tzinfo=UTC), datetime(2026, 12, 2, 9, 0, tzinfo=UTC)),
        ("daily", datetime(2029, 6, 10, 12, 0, tzinfo=UTC), datetime(2029, 6, 11, 9, 0, tzinfo=UTC)),
        ("weekly", datetime(2026, 12, 3, 0, 0, tzinfo=UTC), datetime(2026, 12, 8, 9, 0, tzinfo=UTC)),
        ("weekly", datetime(2030, 1, 1, 0, 0, tzinfo=UTC), datetime(2030, 1, 1, 9, 0, tzinfo=UTC)),
        ("monthly", datetime(2027, 3, 1, 10, 0, tzinfo=UTC), datetime(2027, 4, 1, 9, 0, tzinfo=UTC)),
        ("yearly", datetime(2031, 12, 1, 9, 0, tzinfo=UTC), datetime(2032, 12, 1, 9, 0, tzinfo=UTC)),
    ],
)
def test_next_occurrence_of_a_repeating_event(repeat, after, expected_start):
    start, end = next_occurrence(fake_event(repeat), after)
    assert start == expected_start
    assert end - start == timedelta(hours=1)


def test_repeat_until_is_inclusive():
    event = fake_event("daily", until=date(2026, 12, 3))
    assert next_occurrence(event, datetime(2026, 12, 3, 8, 0, tzinfo=UTC))[0] == datetime(2026, 12, 3, 9, 0, tzinfo=UTC)
    assert next_occurrence(event, datetime(2026, 12, 3, 9, 0, tzinfo=UTC)) is None


def test_local_time_is_kept_across_daylight_saving():
    # 09:00 in Belgrade: 08:00 UTC in winter, 07:00 UTC in summer.
    event = fake_event("monthly", start=datetime(2026, 1, 15, 8, 0, tzinfo=UTC), tz="Europe/Belgrade")
    assert occurrence(event, 1)[0] == datetime(2026, 2, 15, 8, 0, tzinfo=UTC)
    assert occurrence(event, 6)[0] == datetime(2026, 7, 15, 7, 0, tzinfo=UTC)


# --- API ----------------------------------------------------------------------------------


def test_create_repeating_event(signed_in):
    event = create(signed_in, repeat="weekly", repeat_until="2027-01-31")
    assert event["repeat"] == "weekly"
    assert event["repeat_until"] == "2027-01-31"
    assert event["friend_ids"] == []

    plain = create(signed_in, repeat_until="2027-01-31")
    assert plain["repeat"] == "none"
    assert plain["repeat_until"] is None  # meaningless without a repeat, so dropped


@pytest.mark.parametrize(
    "extra", [{"repeat": "hourly"}, {"repeat": "daily", "repeat_until": "2026-11-01"}, {"repeat": "daily", "repeat_until": "soon"}]
)
def test_repeat_validation(signed_in, extra):
    assert signed_in.post("/api/events", json=event_json(**extra)).status_code == 400


# --- Invitations --------------------------------------------------------------------------


def test_inviting_friends_emails_them_once(signed_in, outbox):
    ana, bo = friend(signed_in), friend(signed_in, "bo@example.com", "Bo")
    outbox.clear()

    r = signed_in.post(
        "/api/events",
        json=event_json(friend_ids=[ana["id"]], location="Room 1", repeat="weekly", timezone="Europe/Belgrade"),
    )
    event = r.get_json()
    assert event["friend_ids"] == [ana["id"]]
    (to, subject, body), = outbox
    assert to == "ana@example.com"
    assert subject.startswith("Invitation: Stand-up — Tuesday, 01 December 2026, 10:00–11:00")
    assert "Hello Ana," in body
    assert "user@example.com invited you to: Stand-up" in body
    assert "Where: Room 1" in body
    assert "Repeats every week" in body

    # Adding Bo invites only Bo; an unrelated edit invites nobody
    outbox.clear()
    signed_in.patch(f"/api/events/{event['id']}", json={"friend_ids": [ana["id"], bo["id"]]})
    assert [m[0] for m in outbox] == ["bo@example.com"]
    outbox.clear()
    r = signed_in.patch(f"/api/events/{event['id']}", json={"location": "Room 2"})
    assert outbox == []
    assert r.get_json()["friend_ids"] == sorted([ana["id"], bo["id"]])


def test_removing_invitees_and_replacing_the_event(signed_in, outbox):
    ana = friend(signed_in)
    event = create(signed_in, outbox, friend_ids=[ana["id"]])

    assert signed_in.patch(f"/api/events/{event['id']}", json={"friend_ids": []}).get_json()["friend_ids"] == []
    signed_in.patch(f"/api/events/{event['id']}", json={"friend_ids": [ana["id"]]})
    # PUT without the key means "no invitees"
    assert signed_in.put(f"/api/events/{event['id']}", json=event_json()).get_json()["friend_ids"] == []


def test_invitee_validation_and_isolation(signed_in, other, outbox):
    theirs = friend(other, "x@example.com", "X")
    assert signed_in.post("/api/events", json=event_json(friend_ids=[theirs["id"]])).status_code == 404
    assert signed_in.post("/api/events", json=event_json(friend_ids="all")).status_code == 400
    assert signed_in.post("/api/events", json=event_json(friend_ids=[9999])).status_code == 404
    assert signed_in.get("/api/events").get_json()["items"] == []


def test_deleting_a_friend_removes_them_from_events(signed_in, outbox):
    ana = friend(signed_in)
    event = create(signed_in, outbox, friend_ids=[ana["id"]])
    signed_in.delete(f"/api/friends/{ana['id']}")
    assert signed_in.get(f"/api/events/{event['id']}").get_json()["friend_ids"] == []


def test_failed_invitation_does_not_fail_the_save(signed_in, monkeypatch):
    ana = friend(signed_in)

    def boom(*args):
        raise OSError("smtp down")

    monkeypatch.setattr(events_module, "send_email", boom)
    assert signed_in.post("/api/events", json=event_json(friend_ids=[ana["id"]])).status_code == 201


# --- Reminders -----------------------------------------------------------------------------


def test_reminder_also_goes_to_invited_friends(signed_in, outbox):
    ana = friend(signed_in)
    create(signed_in, outbox, reminder_minutes=30, friend_ids=[ana["id"]])

    assert reminders.send_due_reminders(START - timedelta(minutes=30)) == 1
    assert [m[0] for m in outbox] == ["user@example.com", "ana@example.com"]
    assert "Open your calendar" in outbox[0][2]
    assert "Open your calendar" not in outbox[1][2]  # invitees have no account
    assert outbox[1][1].startswith("Reminder: Stand-up")


def test_repeating_event_is_reminded_for_every_occurrence(signed_in, outbox):
    create(signed_in, outbox, repeat="daily", reminder_minutes=30)
    day = timedelta(days=1)

    assert reminders.send_due_reminders(START - timedelta(minutes=31)) == 0
    assert reminders.send_due_reminders(START - timedelta(minutes=30)) == 1
    assert reminders.send_due_reminders(START - timedelta(minutes=10)) == 0  # same occurrence
    assert "Tuesday, 01 December 2026" in outbox[0][1]

    assert reminders.send_due_reminders(START + day - timedelta(minutes=45)) == 0
    assert reminders.send_due_reminders(START + day - timedelta(minutes=20)) == 1
    assert "Wednesday, 02 December 2026" in outbox[1][1]
    assert "Repeats every day" in outbox[1][2]

    # Years later it still works, one reminder per occurrence
    far = START + timedelta(days=1000)
    assert reminders.send_due_reminders(far - timedelta(minutes=5)) == 1
    assert reminders.send_due_reminders(far - timedelta(minutes=4)) == 0
    assert len(outbox) == 3


def test_no_reminders_after_repeat_until(signed_in, outbox):
    create(signed_in, outbox, repeat="daily", repeat_until="2026-12-02", reminder_minutes=30)
    assert reminders.send_due_reminders(START + timedelta(days=1) - timedelta(minutes=10)) == 1
    assert reminders.send_due_reminders(START + timedelta(days=2) - timedelta(minutes=10)) == 0
    assert reminders.send_due_reminders(START + timedelta(days=30)) == 0


def test_changing_the_schedule_resets_the_reminder(signed_in, outbox):
    event = create(signed_in, outbox, repeat="weekly", reminder_minutes=60)
    now = START - timedelta(minutes=30)
    assert reminders.send_due_reminders(now) == 1
    assert reminders.send_due_reminders(now) == 0

    signed_in.patch(f"/api/events/{event['id']}", json={"repeat": "daily"})
    assert reminders.send_due_reminders(now) == 1  # due again after the change


def test_failed_reminder_for_an_occurrence_is_retried(signed_in, outbox, monkeypatch):
    create(signed_in, outbox, repeat="daily", reminder_minutes=30)
    assert reminders.send_due_reminders(START - timedelta(minutes=10)) == 1

    def boom(*args):
        raise OSError("smtp down")

    tomorrow = START + timedelta(days=1) - timedelta(minutes=10)
    monkeypatch.setattr(reminders, "send_email", boom)
    assert reminders.send_due_reminders(tomorrow) == 0
    monkeypatch.setattr(reminders, "send_email", lambda *args: outbox.append(args))
    assert reminders.send_due_reminders(tomorrow) == 1
    assert reminders.send_due_reminders(tomorrow) == 0
