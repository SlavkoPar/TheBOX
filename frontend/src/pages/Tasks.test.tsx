import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Task, TaskList } from '../api'
import { formatDate } from '../common/format'
import { USER, lastBody, mockApi, renderApp } from '../test/utils'
import Tasks from './Tasks'

const ME = { 'GET /api/auth/me': { body: { user: USER } } }
const NO_LISTS = { 'GET /api/task-lists': { body: { items: [] } } }

function task(id: number, title: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    title,
    notes: '',
    due_date: null,
    is_done: false,
    list_id: null,
    parent_id: null,
    repeat: 'none',
    completed_at: null,
    created_at: '2026-11-22T08:00:00+00:00',
    ...extra,
  }
}

describe('Tasks', () => {
  it('shows open tasks and hides completed ones until asked', async () => {
    mockApi({
      ...ME,
      ...NO_LISTS,
      'GET /api/tasks': {
        body: {
          items: [
            task(1, 'Write report', { due_date: '2020-01-01' }),
            task(2, 'Old chore', { is_done: true }),
          ],
        },
      },
    })
    renderApp(<Tasks />)

    const open = await screen.findByRole('list', { name: 'Open tasks' })
    expect(within(open).getByText('Write report')).toBeInTheDocument()
    expect(within(open).getByText(/Overdue/)).toBeInTheDocument()
    expect(screen.queryByText('Old chore')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Show completed (1)' }))
    expect(screen.getByText('Old chore')).toBeInTheDocument()
  })

  it('adds a task with a due date and clears the form', async () => {
    const items: Task[] = []
    const fetchMock = mockApi({
      ...ME,
      ...NO_LISTS,
      'GET /api/tasks': () => ({ body: { items } }),
      'POST /api/tasks': (body) => {
        items.push(task(1, (body as Task).title, body as Partial<Task>))
        return { status: 201, body: items[0] }
      },
    })
    renderApp(<Tasks />)
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('New task'), 'Buy milk')
    await user.type(screen.getByLabelText('Due date'), '2026-12-24')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByText('Buy milk')).toBeInTheDocument()
    expect(lastBody(fetchMock, 'POST /api/tasks')).toEqual({
      title: 'Buy milk',
      notes: '',
      due_date: '2026-12-24',
      is_done: false,
      list_id: null,
      parent_id: null,
      repeat: 'none',
    })
    expect(screen.getByLabelText('New task')).toHaveValue('')
  })

  it('marks a task as done', async () => {
    let items = [task(1, 'Call Ana')]
    const fetchMock = mockApi({
      ...ME,
      ...NO_LISTS,
      'GET /api/tasks': () => ({ body: { items } }),
      'PATCH /api/tasks/1': (body) => {
        items = [{ ...items[0], ...(body as Partial<Task>) }]
        return { body: items[0] }
      },
    })
    renderApp(<Tasks />)

    await userEvent.click(await screen.findByRole('checkbox', { name: 'Mark “Call Ana” as done' }))

    expect(await screen.findByText('All done.')).toBeInTheDocument()
    expect(lastBody(fetchMock, 'PATCH /api/tasks/1')).toEqual({ is_done: true })
    expect(screen.getByRole('button', { name: 'Show completed (1)' })).toBeInTheDocument()
  })

  it('edits title, notes, due date and repeat', async () => {
    const fetchMock = mockApi({
      ...ME,
      ...NO_LISTS,
      'GET /api/tasks': { body: { items: [task(1, 'Draft', { due_date: '2026-12-01' })] } },
      'PATCH /api/tasks/1': { body: task(1, 'Final') },
    })
    renderApp(<Tasks />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Edit “Draft”' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit task' })
    await user.clear(within(dialog).getByLabelText('Title'))
    await user.type(within(dialog).getByLabelText('Title'), 'Final')
    await user.type(within(dialog).getByLabelText('Notes'), 'two pages')
    await user.clear(within(dialog).getByLabelText('Due date'))
    await user.selectOptions(within(dialog).getByLabelText('Repeat'), 'Every week')
    expect(within(dialog).getByText(/the next one is added automatically/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(lastBody(fetchMock, 'PATCH /api/tasks/1')).toEqual({
      title: 'Final',
      notes: 'two pages',
      due_date: null,
      repeat: 'weekly',
      list_id: null,
    })
  })

  it('shows a load error', async () => {
    mockApi({ ...ME, ...NO_LISTS, 'GET /api/tasks': { status: 500, body: { error: 'Server error.' } } })
    renderApp(<Tasks />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Server error.')
  })
})

describe('Tasks: lists', () => {
  const LISTS: TaskList[] = [
    { id: 4, name: 'Work' },
    { id: 5, name: 'Home' },
  ]
  const ITEMS = [task(1, 'Default task'), task(2, 'Work task', { list_id: 4 }), task(3, 'Another work task', { list_id: 4 })]

  it('shows one list at a time, with a count of open tasks on each', async () => {
    mockApi({ ...ME, 'GET /api/task-lists': { body: { items: LISTS } }, 'GET /api/tasks': { body: { items: ITEMS } } })
    renderApp(<Tasks />)
    const user = userEvent.setup()

    expect(await screen.findByText('Default task')).toBeInTheDocument()
    expect(screen.queryByText('Work task')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'My tasks' })).toBeInTheDocument()

    const lists = screen.getByRole('complementary', { name: 'Lists' })
    const work = within(lists).getByRole('button', { name: /Work/ })
    expect(work).toHaveTextContent('2')
    await user.click(work)

    expect(screen.getByRole('heading', { name: 'Work' })).toBeInTheDocument()
    expect(screen.getByText('Work task')).toBeInTheDocument()
    expect(screen.queryByText('Default task')).not.toBeInTheDocument()
    expect(work).toHaveAttribute('aria-current', 'true')

    await user.click(within(lists).getByRole('button', { name: /Home/ }))
    expect(screen.getByText(/Nothing to do yet/)).toBeInTheDocument()
  })

  it('adds new tasks to the list that is open', async () => {
    const fetchMock = mockApi({
      ...ME,
      'GET /api/task-lists': { body: { items: LISTS } },
      'GET /api/tasks': { body: { items: ITEMS } },
      'POST /api/tasks': (body) => ({ status: 201, body: task(9, 'x', body as Partial<Task>) }),
    })
    renderApp(<Tasks />, '/tasks?list=4')
    const user = userEvent.setup()

    await screen.findByRole('heading', { name: 'Work' })
    await user.type(screen.getByLabelText('New task'), 'Send invoice')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect((lastBody(fetchMock, 'POST /api/tasks') as Task).list_id).toBe(4)
  })

  it('creates a list and opens it', async () => {
    const lists = [...LISTS]
    const fetchMock = mockApi({
      ...ME,
      'GET /api/task-lists': () => ({ body: { items: lists } }),
      'GET /api/tasks': { body: { items: ITEMS } },
      'POST /api/task-lists': (body) => {
        lists.push({ id: 6, name: (body as TaskList).name })
        return { status: 201, body: lists[2] }
      },
    })
    renderApp(<Tasks />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'New list' }))
    const dialog = screen.getByRole('dialog', { name: 'New list' })
    await user.type(within(dialog).getByLabelText('Name'), 'Shopping')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    expect(await screen.findByRole('heading', { name: 'Shopping' })).toBeInTheDocument()
    expect(lastBody(fetchMock, 'POST /api/task-lists')).toEqual({ name: 'Shopping' })
  })

  it('deletes a list with its tasks after confirmation and returns to My tasks', async () => {
    let lists = [...LISTS]
    let items = [...ITEMS]
    mockApi({
      ...ME,
      'GET /api/task-lists': () => ({ body: { items: lists } }),
      'GET /api/tasks': () => ({ body: { items } }),
      'DELETE /api/task-lists/4': () => {
        lists = lists.filter((l) => l.id !== 4)
        items = items.filter((t) => t.list_id !== 4)
        return { status: 204 }
      },
    })
    renderApp(<Tasks />, '/tasks?list=4')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Delete list' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete list' })
    expect(dialog).toHaveTextContent('all the tasks in it')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByRole('heading', { name: 'My tasks' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Work/ })).not.toBeInTheDocument()
    // The built-in list cannot be renamed or deleted
    expect(screen.queryByRole('button', { name: 'Delete list' })).not.toBeInTheDocument()
  })

  it('moves a task to another list from the edit dialog', async () => {
    const fetchMock = mockApi({
      ...ME,
      'GET /api/task-lists': { body: { items: LISTS } },
      'GET /api/tasks': { body: { items: ITEMS } },
      'PATCH /api/tasks/1': { body: task(1, 'Default task', { list_id: 5 }) },
    })
    renderApp(<Tasks />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Edit “Default task”' }))
    const dialog = screen.getByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText('List'), 'Home')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect((lastBody(fetchMock, 'PATCH /api/tasks/1') as Task).list_id).toBe(5)
  })
})

describe('Tasks: subtasks and repeats', () => {
  it('shows subtasks under their task and adds one', async () => {
    const items = [task(1, 'Plan trip'), task(2, 'Book hotel', { parent_id: 1 })]
    const fetchMock = mockApi({
      ...ME,
      ...NO_LISTS,
      'GET /api/tasks': () => ({ body: { items } }),
      'POST /api/tasks': (body) => {
        items.push(task(3, (body as Task).title, body as Partial<Task>))
        return { status: 201, body: items[2] }
      },
    })
    renderApp(<Tasks />)
    const user = userEvent.setup()

    const subtasks = await screen.findByRole('list', { name: 'Subtasks of “Plan trip”' })
    expect(within(subtasks).getByText('Book hotel')).toBeInTheDocument()
    // A subtask cannot have subtasks of its own
    expect(screen.queryByRole('button', { name: 'Add a subtask to “Book hotel”' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add a subtask to “Plan trip”' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Subtask'), 'Rent a car')
    await user.click(within(dialog).getByRole('button', { name: 'Add subtask' }))

    expect(await within(subtasks).findByText('Rent a car')).toBeInTheDocument()
    expect(lastBody(fetchMock, 'POST /api/tasks')).toMatchObject({ title: 'Rent a car', parent_id: 1, list_id: null })
  })

  it('edits a subtask without list or repeat choices', async () => {
    const fetchMock = mockApi({
      ...ME,
      ...NO_LISTS,
      'GET /api/tasks': { body: { items: [task(1, 'Plan trip'), task(2, 'Book hotel', { parent_id: 1 })] } },
      'PATCH /api/tasks/2': { body: task(2, 'Book hotel', { parent_id: 1 }) },
    })
    renderApp(<Tasks />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Edit “Book hotel”' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit subtask' })
    expect(within(dialog).queryByLabelText('Repeat')).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText('List')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(lastBody(fetchMock, 'PATCH /api/tasks/2')).toEqual({ title: 'Book hotel', notes: '', due_date: null })
  })

  it('marks repeating tasks and shows the next one after completing', async () => {
    let items = [task(1, 'Water plants', { repeat: 'weekly', due_date: '2026-12-01' })]
    mockApi({
      ...ME,
      ...NO_LISTS,
      'GET /api/tasks': () => ({ body: { items } }),
      'PATCH /api/tasks/1': () => {
        // The server completes this one and creates the next
        items = [
          task(2, 'Water plants', { repeat: 'weekly', due_date: '2026-12-08' }),
          task(1, 'Water plants', { repeat: 'weekly', due_date: '2026-12-01', is_done: true }),
        ]
        return { body: items[1] }
      },
    })
    renderApp(<Tasks />)

    const open = await screen.findByRole('list', { name: 'Open tasks' })
    expect(within(open).getByText('Every week')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Mark “Water plants” as done' }))

    // Dates are shown in the browser's own format
    expect(await within(open).findByText(`Due ${formatDate('2026-12-08')}`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show completed (1)' })).toBeInTheDocument()
  })

  it('warns that deleting a task deletes its subtasks', async () => {
    mockApi({
      ...ME,
      ...NO_LISTS,
      'GET /api/tasks': { body: { items: [task(1, 'Plan trip'), task(2, 'Book hotel', { parent_id: 1 })] } },
    })
    renderApp(<Tasks />)

    await userEvent.click(await screen.findByRole('button', { name: 'Delete “Plan trip”' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Delete “Plan trip” and its subtasks?')
  })
})
