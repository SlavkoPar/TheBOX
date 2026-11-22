from .common import Bool, Date, Str, crud_blueprint
from .models import Task, utcnow

SCHEMA = {
    "title": Str(required=True, max_len=255),
    "notes": Str(max_len=5000),
    "due_date": Date(),
    "is_done": Bool(),
}


def _validate(task):
    if task.is_done and task.completed_at is None:
        task.completed_at = utcnow()
    elif not task.is_done:
        task.completed_at = None


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
    noun="Task",
)
