import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { REPEAT_LABELS, taskListsApi, tasksApi } from '../api'
import type { Repeat, Task, TaskInput, TaskList } from '../api'
import { ConfirmDialog, FormModal, PromptDialog } from '../common/Modal'
import ViewToggle from '../common/ViewToggle'
import { dateKey, formatDate } from '../common/format'
import { Icon } from '../common/icons'
import { useAction } from '../common/useAction'
import { useCollection } from '../common/useCollection'
import { useViewMode } from '../common/useViewMode'

const REPEATS = Object.keys(REPEAT_LABELS) as Repeat[]
const DEFAULT_LIST = 'My tasks'

type EditProps = {
  task: Task
  lists: TaskList[]
  onClose: () => void
  onSave: (data: Partial<TaskInput>) => Promise<unknown>
}

function TaskForm({ task, lists, onClose, onSave }: EditProps) {
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes)
  const [dueDate, setDueDate] = useState(task.due_date ?? '')
  const [repeat, setRepeat] = useState<Repeat>(task.repeat)
  const [listId, setListId] = useState(task.list_id === null ? '' : String(task.list_id))
  const isSubtask = task.parent_id !== null

  return (
    <FormModal
      title={isSubtask ? 'Edit subtask' : 'Edit task'}
      submitLabel="Save"
      onClose={onClose}
      onSubmit={() =>
        onSave({
          title,
          notes,
          due_date: dueDate || null,
          // A subtask follows its parent's list and does not repeat.
          ...(isSubtask ? {} : { repeat, list_id: listId === '' ? null : Number(listId) }),
        })
      }
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
      {!isSubtask && (
        <>
          <label>
            Repeat
            <select value={repeat} onChange={(event) => setRepeat(event.target.value as Repeat)}>
              {REPEATS.map((value) => (
                <option key={value} value={value}>
                  {REPEAT_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          {repeat !== 'none' && (
            <p className="hint">When you complete this task, the next one is added automatically.</p>
          )}
          <label>
            List
            <select value={listId} onChange={(event) => setListId(event.target.value)}>
              <option value="">{DEFAULT_LIST}</option>
              {lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
    </FormModal>
  )
}

type ListDialog = { kind: 'new' } | { kind: 'rename'; list: TaskList } | { kind: 'delete'; list: TaskList }

export default function Tasks() {
  const tasks = useCollection(tasksApi)
  const lists = useCollection(taskListsApi)
  const [params, setParams] = useSearchParams()

  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [editing, setEditing] = useState<Task | null>(null)
  const [deleting, setDeleting] = useState<Task | null>(null)
  const [addingTo, setAddingTo] = useState<Task | null>(null)
  const [listDialog, setListDialog] = useState<ListDialog | null>(null)
  const [showDone, setShowDone] = useState(false)
  const action = useAction()
  const [mode, setMode] = useViewMode('tasks', 'list')
  const listClass = mode === 'grid' ? 'task-list grid' : 'task-list'
  const [today] = useState(() => dateKey(new Date()))

  // The list shown comes from the URL, so it survives a reload and can be linked to.
  const wanted = Number(params.get('list')) || null
  const currentList = lists.items.find((list) => list.id === wanted) ?? null
  const listId = currentList?.id ?? null
  const showList = (id: number | null) => setParams(id ? { list: String(id) } : {})

  const { open, done, subtasks } = useMemo(() => {
    const inList = tasks.items.filter((task) => task.list_id === listId)
    const children = new Map<number, Task[]>()
    for (const task of inList) {
      if (task.parent_id !== null) {
        children.set(task.parent_id, [...(children.get(task.parent_id) ?? []), task])
      }
    }
    const top = inList.filter((task) => task.parent_id === null)
    return {
      open: top.filter((task) => !task.is_done),
      done: top.filter((task) => task.is_done),
      subtasks: children,
    }
  }, [tasks.items, listId])

  const openCount = (id: number | null) =>
    tasks.items.filter((task) => task.list_id === id && task.parent_id === null && !task.is_done).length

  async function add(event: FormEvent) {
    event.preventDefault()
    const added = await action.run(() =>
      tasks.create({
        title,
        notes: '',
        due_date: dueDate || null,
        is_done: false,
        list_id: listId,
        parent_id: null,
        repeat: 'none',
      }),
    )
    if (added) {
      setTitle('')
      setDueDate('')
    }
  }

  function row(task: Task, isSubtask = false) {
    const overdue = !task.is_done && task.due_date !== null && task.due_date < today
    const children = subtasks.get(task.id) ?? []
    return (
      <li key={task.id} className={isSubtask ? 'task-item subtask' : 'task-item'}>
        <div className={task.is_done ? 'task task-done' : 'task'}>
          <input
            type="checkbox"
            checked={task.is_done}
            aria-label={task.is_done ? `Mark “${task.title}” as not done` : `Mark “${task.title}” as done`}
            onChange={() => action.run(() => tasks.update(task.id, { is_done: !task.is_done }))}
          />
          <div className="task-body">
            <span className="task-title">{task.title}</span>
            {task.notes && <span className="task-notes">{task.notes}</span>}
            <span className="task-meta">
              {task.due_date && (
                <span className={overdue ? 'task-due overdue' : 'task-due'}>
                  {overdue ? 'Overdue: ' : 'Due '}
                  {formatDate(task.due_date)}
                </span>
              )}
              {task.repeat !== 'none' && (
                <span className="task-due">
                  <Icon name="repeat" size={13} /> {REPEAT_LABELS[task.repeat]}
                </span>
              )}
            </span>
          </div>
          {!isSubtask && !task.is_done && (
            <button
              type="button"
              className="icon-button"
              aria-label={`Add a subtask to “${task.title}”`}
              title="Add subtask"
              onClick={() => setAddingTo(task)}
            >
              <Icon name="plus" />
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label={`Edit “${task.title}”`}
            title="Edit"
            onClick={() => setEditing(task)}
          >
            <Icon name="edit" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={`Delete “${task.title}”`}
            title="Delete"
            onClick={() => setDeleting(task)}
          >
            <Icon name="trash" />
          </button>
        </div>
        {children.length > 0 && (
          <ul className="subtask-list" aria-label={`Subtasks of “${task.title}”`}>
            {children.map((child) => row(child, true))}
          </ul>
        )}
      </li>
    )
  }

  const error = tasks.error || lists.error || action.error
  const loading = tasks.loading || lists.loading

  return (
    <div className="page tasks-page">
      <aside className="task-lists" aria-label="Lists">
        <h3>Lists</h3>
        <ul>
          {[null, ...lists.items].map((list) => {
            const id = list?.id ?? null
            return (
              <li key={id ?? 'default'}>
                <button
                  type="button"
                  className={id === listId ? 'list-button current' : 'list-button'}
                  aria-current={id === listId ? 'true' : undefined}
                  onClick={() => showList(id)}
                >
                  <Icon name="list" size={18} />
                  <span>{list?.name ?? DEFAULT_LIST}</span>
                  <small>{openCount(id) || ''}</small>
                </button>
              </li>
            )
          })}
        </ul>
        <button type="button" className="secondary" onClick={() => setListDialog({ kind: 'new' })}>
          <Icon name="plus" size={18} /> New list
        </button>
      </aside>

      <section className="task-main">
        <div className="page-header">
          <h2>{currentList?.name ?? DEFAULT_LIST}</h2>
          <div className="toolbar">
            <ViewToggle mode={mode} onChange={setMode} />
            {currentList && (
              <>
                <button type="button" className="secondary" onClick={() => setListDialog({ kind: 'rename', list: currentList })}>
                  Rename list
                </button>
                <button type="button" className="secondary" onClick={() => setListDialog({ kind: 'delete', list: currentList })}>
                  Delete list
                </button>
              </>
            )}
          </div>
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

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {loading ? (
          <p>Loading…</p>
        ) : open.length + done.length === 0 ? (
          <p className="empty">Nothing to do yet. Add your first task above.</p>
        ) : (
          <>
            {open.length === 0 ? (
              <p className="empty">All done.</p>
            ) : (
              <ul className={listClass} aria-label="Open tasks">
                {open.map((task) => row(task))}
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
                  <ul className={listClass} aria-label="Completed tasks">
                    {done.map((task) => row(task))}
                  </ul>
                )}
              </>
            )}
          </>
        )}
      </section>

      {editing && (
        <TaskForm
          task={editing}
          lists={lists.items}
          onClose={() => setEditing(null)}
          onSave={(data) => tasks.update(editing.id, data)}
        />
      )}

      {addingTo && (
        <PromptDialog
          title={`Add a subtask to “${addingTo.title}”`}
          label="Subtask"
          submitLabel="Add subtask"
          onClose={() => setAddingTo(null)}
          onSubmit={(subtitle) =>
            tasks.create({
              title: subtitle,
              notes: '',
              due_date: null,
              is_done: false,
              list_id: addingTo.list_id,
              parent_id: addingTo.id,
              repeat: 'none',
            })
          }
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete task"
          message={
            (subtasks.get(deleting.id)?.length ?? 0) > 0
              ? `Delete “${deleting.title}” and its subtasks?`
              : `Delete “${deleting.title}”?`
          }
          confirmLabel="Delete"
          onClose={() => setDeleting(null)}
          onConfirm={() => tasks.remove(deleting.id)}
        />
      )}

      {listDialog?.kind === 'new' && (
        <PromptDialog
          title="New list"
          label="Name"
          submitLabel="Create"
          onClose={() => setListDialog(null)}
          onSubmit={async (name) => {
            const created = await taskListsApi.create({ name })
            await lists.reload()
            showList(created.id)
          }}
        />
      )}

      {listDialog?.kind === 'rename' && (
        <PromptDialog
          title="Rename list"
          label="Name"
          submitLabel="Rename"
          initial={listDialog.list.name}
          onClose={() => setListDialog(null)}
          onSubmit={(name) => lists.update(listDialog.list.id, { name })}
        />
      )}

      {listDialog?.kind === 'delete' && (
        <ConfirmDialog
          title="Delete list"
          message={`Delete the list “${listDialog.list.name}” and all the tasks in it?`}
          confirmLabel="Delete"
          onClose={() => setListDialog(null)}
          onConfirm={async () => {
            await lists.remove(listDialog.list.id)
            showList(null)
            await tasks.reload()
          }}
        />
      )}
    </div>
  )
}
