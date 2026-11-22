import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Task } from '../api'
import { USER, lastBody, mockApi, renderApp } from '../test/utils'
import Tasks from './Tasks'

const ME = { 'GET /api/auth/me': { body: { user: USER } } }

function task(id: number, title: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    title,
    notes: '',
    due_date: null,
    is_done: false,
    completed_at: null,
    created_at: '2026-11-22T08:00:00+00:00',
    ...extra,
  }
}

describe('Tasks', () => {
  it('shows open tasks and hides completed ones until asked', async () => {
    mockApi({
      ...ME,
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
    })
    expect(screen.getByLabelText('New task')).toHaveValue('')
  })

  it('marks a task as done', async () => {
    let items = [task(1, 'Call Ana')]
    const fetchMock = mockApi({
      ...ME,
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

  it('edits title, notes and due date', async () => {
    const fetchMock = mockApi({
      ...ME,
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
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(lastBody(fetchMock, 'PATCH /api/tasks/1')).toEqual({
      title: 'Final',
      notes: 'two pages',
      due_date: null,
    })
  })

  it('shows a load error', async () => {
    mockApi({ ...ME, 'GET /api/tasks': { status: 500, body: { error: 'Server error.' } } })
    renderApp(<Tasks />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Server error.')
  })
})
