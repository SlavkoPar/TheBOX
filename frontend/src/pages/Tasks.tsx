import { useState } from 'react'
import type { FormEvent } from 'react'
import { tasksApi } from '../api'
import type { Task } from '../api'
import { ConfirmDialog, FormModal } from '../common/Modal'
import { useAction } from '../common/useAction'
import { dateKey, formatDate } from '../common/format'
import { Icon } from '../common/icons'
import { useCollection } from '../common/useCollection'

type EditProps = {
  task: Task
  onClose: () => void
  onSave: (data: { title: string; notes: string; due_date: string | null }) => Promise<unknown>
}

function TaskForm({ task, onClose, onSave }: EditProps) {
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes)
  const [dueDate, setDueDate] = useState(task.due_date ?? '')

  return (
    <FormModal
      title="Edit task"
      submitLabel="Save"
      onClose={onClose}
      onSubmit={() => onSave({ title, notes, due_date: dueDate || null })}
    >
      <label>
        Title
        <input value={title} required onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        Notes
        <textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      <label>
        Due date
        <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
      </label>
    </FormModal>
  )
}

export default function Tasks() {
  const { items, loading, error, create, update, remove } = useCollection(tasksApi)
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [editing, setEditing] = useState<Task | null>(null)
  const [deleting, setDeleting] = useState<Task | null>(null)
  const [showDone, setShowDone] = useState(false)
  const action = useAction()

  const open = items.filter((task) => !task.is_done)
  const done = items.filter((task) => task.is_done)
  const [today] = useState(() => dateKey(new Date()))

  async function add(event: FormEvent) {
    event.preventDefault()
    const added = await action.run(() =>
      create({ title, notes: '', due_date: dueDate || null, is_done: false }),
    )
    if (added) {
      setTitle('')
      setDueDate('')
    }
  }

  function row(task: Task) {
    const overdue = !task.is_done && task.due_date !== null && task.due_date < today
    return (
      <li key={task.id} className={task.is_done ? 'task task-done' : 'task'}>
        <input
          type="checkbox"
          checked={task.is_done}
          aria-label={task.is_done ? `Mark “${task.title}” as not done` : `Mark “${task.title}” as done`}
          onChange={() => action.run(() => update(task.id, { is_done: !task.is_done }))}
        />
        <div className="task-body">
          <span className="task-title">{task.title}</span>
          {task.notes && <span className="task-notes">{task.notes}</span>}
          {task.due_date && (
            <span className={overdue ? 'task-due overdue' : 'task-due'}>
              {overdue ? 'Overdue: ' : 'Due '}
              {formatDate(task.due_date)}
            </span>
          )}
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={`Edit “${task.title}”`}
          onClick={() => setEditing(task)}
        >
          <Icon name="edit" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`Delete “${task.title}”`}
          onClick={() => setDeleting(task)}
        >
          <Icon name="trash" />
        </button>
      </li>
    )
  }

  return (
    <div className="page page-narrow">
      <div className="page-header">
        <h2>Tasks</h2>
      </div>

      <form className="inline-form" onSubmit={add}>
        <input
          aria-label="New task"
          placeholder="Add a task"
          value={title}
          required
          onChange={(event) => setTitle(event.target.value)}
        />
        <input
          type="date"
          aria-label="Due date"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
        />
        <button type="submit" disabled={action.busy}>
          <Icon name="plus" size={18} /> Add
        </button>
      </form>

      {(error || action.error) && (
        <p className="error" role="alert">
          {error || action.error}
        </p>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : items.length === 0 ? (
        <p className="empty">Nothing to do yet. Add your first task above.</p>
      ) : (
        <>
          {open.length === 0 ? (
            <p className="empty">All done.</p>
          ) : (
            <ul className="task-list" aria-label="Open tasks">
              {open.map(row)}
            </ul>
          )}

          {done.length > 0 && (
            <>
              <button
                type="button"
                className="link-button"
                aria-expanded={showDone}
                onClick={() => setShowDone(!showDone)}
              >
                {showDone ? 'Hide' : 'Show'} completed ({done.length})
              </button>
              {showDone && (
                <ul className="task-list" aria-label="Completed tasks">
                  {done.map(row)}
                </ul>
              )}
            </>
          )}
        </>
      )}

      {editing && (
        <TaskForm
          task={editing}
          onClose={() => setEditing(null)}
          onSave={(data) => update(editing.id, data)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete task"
          message={`Delete “${deleting.title}”?`}
          confirmLabel="Delete"
          onClose={() => setDeleting(null)}
          onConfirm={() => remove(deleting.id)}
        />
      )}
    </div>
  )
}
