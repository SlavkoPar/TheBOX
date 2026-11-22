from datetime import date

from flask import request

from .common import ApiError, Bool, Choice, Date, Int, Str, crud_blueprint
from .extensions import db
from .models import TASK_REPEATS, Task, TaskList, utcnow
from .recurrence import shift

SCHEMA = {
    "title": Str(required=True, max_len=255),
    "notes": Str(max_len=5000),
    "due_date": Date(),
    "is_done": Bool(),
    "list_id": Int(label="List"),  # null = the built-in "My tasks" list
    "parent_id": Int(label="Parent task"),  # set for a subtask
    "repeat": Choice(TASK_REPEATS),
}


def _next_due(due, repeat, today=None):
    """Next due date of a repeating task: the first one after today."""
    today = today or date.today()
    base = due or today
    for n in range(1, 2000):
        candidate = shift(base, repeat, n)
        if candidate > today:
            return candidate
    return shift(base, repeat, 1)


def _validate(task):
    if task.parent_id is not None:
        parent = db.session.get(Task, task.parent_id)
        if parent is None or parent.user_id != task.user_id or parent.id == task.id:
            raise ApiError("Parent task not found.", 404)
        if parent.parent_id is not None:
            raise ApiError("A subtask cannot have subtasks of its own.")
        if task.subtasks:
            raise ApiError("A task that has subtasks cannot become a subtask.")
        task.list_id = parent.list_id  # a subtask lives in its parent's list
        task.repeat = "none"

    if task.list_id is not None:
        task_list = db.session.get(TaskList, task.list_id)
        if task_list is None or task_list.user_id != task.user_id:
            raise ApiError("List not found.", 404)

    for subtask in task.subtasks:
        subtask.list_id = task.list_id  # moving a task moves its subtasks

    if not task.is_done:
        task.completed_at = None
        return

    if task.completed_at is None:  # just completed
        now = utcnow()
        task.completed_at = now
        for subtask in task.subtasks:
            if not subtask.is_done:
                subtask.is_done = True
                subtask.completed_at = now
        if task.repeat != "none" and task.parent_id is None:
            db.session.add(
                Task(
                    user_id=task.user_id,
                    list_id=task.list_id,
                    title=task.title,
                    notes=task.notes,
                    repeat=task.repeat,
                    due_date=_next_due(task.due_date, task.repeat),
                )
            )


def _filter(query):
    """?list=default for "My tasks", ?list=<id> for another list; all lists otherwise."""
    wanted = request.args.get("list")
    if wanted == "default":
        return query.where(Task.list_id.is_(None))
    if wanted:
        try:
            return query.where(Task.list_id == int(wanted))
        except ValueError:
            raise ApiError("List not found.", 404) from None
    return query


tasks = crud_blueprint(
    "tasks",
    Task,
    SCHEMA,
    # Open tasks first, then by due date (tasks without one last), newest first.
    order_by=lambda: (
        Task.is_done,
        Task.due_date.is_(None),
        Task.due_date,
        Task.id.desc(),
    ),
    validate=_validate,
    list_filter=_filter,
    noun="Task",
)

# Named lists besides the built-in "My tasks". Deleting a list deletes its tasks.
task_lists = crud_blueprint(
    "task_lists",
    TaskList,
    {"name": Str(required=True, max_len=100)},
    order_by=lambda: (db.func.lower(TaskList.name), TaskList.id),
    noun="List",
)
