"""Task lists, subtasks and repeating tasks."""

from datetime import date, timedelta

import pytest

from app import tasks as tasks_module
from app.extensions import db
from app.models import Task


def add(client, title, **extra):
    r = client.post("/api/tasks", json={"title": title, **extra})
    assert r.status_code == 201, r.get_json()
    return r.get_json()


def new_list(client, name):
    r = client.post("/api/task-lists", json={"name": name})
    assert r.status_code == 201, r.get_json()
    return r.get_json()


def titles(client, query=""):
    return [t["title"] for t in client.get(f"/api/tasks{query}").get_json()["items"]]


# --- Lists ------------------------------------------------------------------------


def test_lists_crud(signed_in):
    work = new_list(signed_in, "Work")
    new_list(signed_in, "home")
    assert [l["name"] for l in signed_in.get("/api/task-lists").get_json()["items"]] == ["home", "Work"]

    r = signed_in.patch(f"/api/task-lists/{work['id']}", json={"name": "Office"})
    assert r.get_json()["name"] == "Office"
    assert signed_in.post("/api/task-lists", json={"name": " "}).status_code == 400
    assert signed_in.delete(f"/api/task-lists/{work['id']}").status_code == 204


def test_tasks_belong_to_a_list_or_to_my_tasks(signed_in):
    work = new_list(signed_in, "Work")
    add(signed_in, "Default task")
    add(signed_in, "Work task", list_id=work["id"])

    assert titles(signed_in, "?list=default") == ["Default task"]
    assert titles(signed_in, f"?list={work['id']}") == ["Work task"]
    assert sorted(titles(signed_in)) == ["Default task", "Work task"]
    assert signed_in.get("/api/tasks?list=abc").status_code == 404


def test_move_task_to_another_list(signed_in):
    work = new_list(signed_in, "Work")
    task = add(signed_in, "Move me")
    r = signed_in.patch(f"/api/tasks/{task['id']}", json={"list_id": work["id"]})
    assert r.get_json()["list_id"] == work["id"]
    assert signed_in.patch(f"/api/tasks/{task['id']}", json={"list_id": None}).get_json()["list_id"] is None
    assert signed_in.patch(f"/api/tasks/{task['id']}", json={"list_id": 9999}).status_code == 404


def test_deleting_a_list_deletes_its_tasks(signed_in):
    work = new_list(signed_in, "Work")
    parent = add(signed_in, "Work task", list_id=work["id"])
    add(signed_in, "Work subtask", parent_id=parent["id"])
    add(signed_in, "Default task")

    signed_in.delete(f"/api/task-lists/{work['id']}")
    assert titles(signed_in) == ["Default task"]


def test_lists_are_private(signed_in, other):
    work = new_list(signed_in, "Work")
    assert other.get("/api/task-lists").get_json()["items"] == []
    assert other.delete(f"/api/task-lists/{work['id']}").status_code == 404
    assert other.post("/api/tasks", json={"title": "x", "list_id": work["id"]}).status_code == 404


# --- Subtasks ----------------------------------------------------------------------


def test_subtask_lives_under_its_parent_in_the_same_list(signed_in):
    work = new_list(signed_in, "Work")
    parent = add(signed_in, "Plan trip", list_id=work["id"])
    sub = add(signed_in, "Book hotel", parent_id=parent["id"], repeat="weekly")

    assert sub["parent_id"] == parent["id"]
    assert sub["list_id"] == work["id"]  # inherited
    assert sub["repeat"] == "none"  # subtasks do not repeat


def test_subtasks_are_one_level_deep(signed_in):
    parent = add(signed_in, "Parent")
    sub = add(signed_in, "Sub", parent_id=parent["id"])
    other_parent = add(signed_in, "Other parent")

    assert signed_in.post("/api/tasks", json={"title": "x", "parent_id": sub["id"]}).status_code == 400
    assert signed_in.patch(f"/api/tasks/{parent['id']}", json={"parent_id": other_parent["id"]}).status_code == 400
    assert signed_in.patch(f"/api/tasks/{parent['id']}", json={"parent_id": parent["id"]}).status_code == 404
    assert signed_in.post("/api/tasks", json={"title": "x", "parent_id": 9999}).status_code == 404


def test_completing_or_moving_or_deleting_a_parent_carries_its_subtasks(signed_in):
    work = new_list(signed_in, "Work")
    parent = add(signed_in, "Parent")
    sub = add(signed_in, "Sub", parent_id=parent["id"])

    signed_in.patch(f"/api/tasks/{parent['id']}", json={"list_id": work["id"]})
    assert signed_in.get(f"/api/tasks/{sub['id']}").get_json()["list_id"] == work["id"]

    signed_in.patch(f"/api/tasks/{parent['id']}", json={"is_done": True})
    done_sub = signed_in.get(f"/api/tasks/{sub['id']}").get_json()
    assert done_sub["is_done"] is True and done_sub["completed_at"] is not None

    # Completing a subtask does not complete the parent
    second = add(signed_in, "Parent 2")
    second_sub = add(signed_in, "Sub 2", parent_id=second["id"])
    signed_in.patch(f"/api/tasks/{second_sub['id']}", json={"is_done": True})
    assert signed_in.get(f"/api/tasks/{second['id']}").get_json()["is_done"] is False

    signed_in.delete(f"/api/tasks/{parent['id']}")
    assert db.session.get(Task, sub["id"]) is None


def test_subtask_cannot_point_at_another_users_task(signed_in, other):
    theirs = add(other, "Theirs")
    assert signed_in.post("/api/tasks", json={"title": "x", "parent_id": theirs["id"]}).status_code == 404


# --- Repeating tasks -----------------------------------------------------------------


def test_completing_a_repeating_task_creates_the_next_one(signed_in):
    future = date.today() + timedelta(days=3)
    task = add(signed_in, "Water plants", notes="balcony too", repeat="weekly", due_date=future.isoformat())

    signed_in.patch(f"/api/tasks/{task['id']}", json={"is_done": True})

    open_tasks = [t for t in signed_in.get("/api/tasks").get_json()["items"] if not t["is_done"]]
    assert len(open_tasks) == 1
    next_task = open_tasks[0]
    assert next_task["id"] != task["id"]
    assert next_task["title"] == "Water plants"
    assert next_task["notes"] == "balcony too"
    assert next_task["repeat"] == "weekly"
    assert next_task["due_date"] == (future + timedelta(days=7)).isoformat()


def test_next_task_is_created_once_and_stays_in_the_list(signed_in):
    work = new_list(signed_in, "Work")
    task = add(signed_in, "Report", repeat="daily", list_id=work["id"])
    signed_in.patch(f"/api/tasks/{task['id']}", json={"is_done": True})
    signed_in.patch(f"/api/tasks/{task['id']}", json={"notes": "edited after completion"})

    all_tasks = signed_in.get(f"/api/tasks?list={work['id']}").get_json()["items"]
    assert len(all_tasks) == 2
    assert [t["due_date"] for t in all_tasks if not t["is_done"]] == [
        (date.today() + timedelta(days=1)).isoformat()
    ]


def test_non_repeating_task_creates_nothing(signed_in):
    task = add(signed_in, "Once")
    signed_in.patch(f"/api/tasks/{task['id']}", json={"is_done": True})
    assert len(signed_in.get("/api/tasks").get_json()["items"]) == 1
    assert signed_in.post("/api/tasks", json={"title": "x", "repeat": "hourly"}).status_code == 400


@pytest.mark.parametrize(
    "due, repeat, today, expected",
    [
        (date(2026, 12, 1), "daily", date(2026, 11, 22), date(2026, 12, 2)),
        (date(2026, 12, 1), "weekly", date(2026, 11, 22), date(2026, 12, 8)),
        (date(2026, 1, 31), "monthly", date(2026, 1, 15), date(2026, 2, 28)),  # clamped
        (date(2024, 2, 29), "yearly", date(2024, 3, 1), date(2025, 2, 28)),
        # Long overdue: skip the dates that have already passed
        (date(2026, 1, 5), "weekly", date(2026, 11, 22), date(2026, 11, 23)),
        (None, "monthly", date(2026, 11, 22), date(2026, 12, 22)),  # no due date: from today
    ],
)
def test_next_due_date(due, repeat, today, expected):
    assert tasks_module._next_due(due, repeat, today) == expected
