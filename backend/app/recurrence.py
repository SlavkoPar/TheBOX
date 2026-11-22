"""Repeating dates, shared by Tasks (next due date) and Calendar (occurrences)."""

import calendar
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

REPEATS = ("none", "daily", "weekly", "monthly", "yearly")


def shift(day: date, repeat: str, n: int) -> date:
    """The date `n` periods after `day`.

    Monthly and yearly keep the day of the month, clamped to the month's length
    (31 Jan -> 28/29 Feb -> 31 Mar; 29 Feb -> 28 Feb in other years). Always
    counted from the original date, so the clamp does not stick.
    """
    if repeat == "daily":
        return day + timedelta(days=n)
    if repeat == "weekly":
        return day + timedelta(weeks=n)
    if repeat in ("monthly", "yearly"):
        months = day.month - 1 + (n if repeat == "monthly" else 12 * n)
        year, month = day.year + months // 12, months % 12 + 1
        return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))
    return day


def _zone(name):
    try:
        return ZoneInfo(name)
    except Exception:
        return timezone.utc


def _aware(value):
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def occurrence(event, n):
    """(start, end) in UTC of the n-th occurrence of an event (0 = the first)."""
    start = _aware(event.starts_at)
    duration = _aware(event.ends_at) - start
    if n == 0 or event.repeat == "none":
        return start.astimezone(timezone.utc), (start + duration).astimezone(timezone.utc)

    # Step in the event's own time zone so 09:00 stays 09:00 across DST changes.
    zone = _zone(event.timezone)
    local = start.astimezone(zone)
    day = shift(local.date(), event.repeat, n)
    shifted = datetime.combine(day, local.time(), tzinfo=zone).astimezone(timezone.utc)
    return shifted, shifted + duration


def _estimate(event, after):
    """An index at or just before the first occurrence after `after`."""
    start = _aware(event.starts_at)
    days = (after - start).days
    if days <= 0:
        return 0
    if event.repeat == "daily":
        return days
    if event.repeat == "weekly":
        return days // 7
    if event.repeat == "monthly":
        return days // 31
    return days // 366


def next_occurrence(event, after):
    """First occurrence that starts after `after`, or None if there is none."""
    after = _aware(after)
    if event.repeat == "none":
        start, end = occurrence(event, 0)
        return (start, end) if start > after else None

    zone = _zone(event.timezone)
    n = max(0, _estimate(event, after) - 1)
    for _ in range(400):  # the estimate is close; this bound is never reached
        start, end = occurrence(event, n)
        if event.repeat_until and start.astimezone(zone).date() > event.repeat_until:
            return None
        if start > after:
            return start, end
        n += 1
    return None
