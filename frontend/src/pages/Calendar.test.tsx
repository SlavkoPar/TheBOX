import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { CalendarEvent, EventInput } from '../api'
import { USER, lastBody, mockApi, renderApp } from '../test/utils'
import Calendar from './Calendar'

const ME = { 'GET /api/auth/me': { body: { user: USER } } }

/** An event at the given local hour on the 15th of the current month. */
function eventThisMonth(extra: Partial<CalendarEvent> = {}): CalendarEvent {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 15, 14, 0)
  const end = new Date(now.getFullYear(), now.getMonth(), 15, 15, 0)
  return {
    id: 7,
    title: 'Team meeting',
    description: '',
    location: 'Room 1',
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    all_day: false,
    timezone: 'UTC',
    reminder_minutes: 30,
    reminder_sent_at: null,
    ...extra,
  }
}

describe('Calendar', () => {
  it('shows the current month as a grid with its events', async () => {
    mockApi({ ...ME, 'GET /api/events': { body: { items: [eventThisMonth()] } } })
    renderApp(<Calendar />)

    const now = new Date()
    expect(
      screen.getByRole('heading', {
        name: now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).toEqual([
      'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
    ])
    expect(screen.getAllByRole('gridcell')).toHaveLength(42)

    const event = await screen.findByRole('button', { name: /Team meeting/ })
    const cell = event.closest('[role="gridcell"]') as HTMLElement
    expect(within(cell).getByText('15')).toBeInTheDocument()
  })

  it('moves between months', async () => {
    mockApi({ ...ME, 'GET /api/events': { body: { items: [] } } })
    renderApp(<Calendar />)
    const now = new Date()
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const title = (date: Date) => date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

    await userEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByRole('heading', { name: title(next) })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(screen.getByRole('heading', { name: title(now) })).toBeInTheDocument()
  })

  it('creates an event with an email reminder', async () => {
    const fetchMock = mockApi({
      ...ME,
      'GET /api/events': { body: { items: [] } },
      'POST /api/events': (body) => ({ status: 201, body: { ...(body as EventInput), id: 1 } }),
    })
    renderApp(<Calendar />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'New event' }))
    const dialog = screen.getByRole('dialog', { name: 'New event' })
    await user.type(within(dialog).getByLabelText('Title'), 'Dentist')
    await user.clear(within(dialog).getByLabelText('Start'))
    await user.type(within(dialog).getByLabelText('Start'), '2026-12-24T10:00')
    await user.clear(within(dialog).getByLabelText('End'))
    await user.type(within(dialog).getByLabelText('End'), '2026-12-24T11:30')
    await user.selectOptions(within(dialog).getByLabelText('Email reminder'), '1 hour before')
    await user.click(within(dialog).getByRole('button', { name: 'Add event' }))

    const sent = lastBody(fetchMock, 'POST /api/events') as EventInput
    expect(sent.title).toBe('Dentist')
    expect(sent.reminder_minutes).toBe(60)
    expect(sent.all_day).toBe(false)
    expect(new Date(sent.starts_at)).toEqual(new Date(2026, 11, 24, 10, 0))
    expect(new Date(sent.ends_at)).toEqual(new Date(2026, 11, 24, 11, 30))
    expect(sent.timezone).toBeTruthy()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('sends no reminder when none is chosen, and whole days for all-day events', async () => {
    const fetchMock = mockApi({
      ...ME,
      'GET /api/events': { body: { items: [] } },
      'POST /api/events': (body) => ({ status: 201, body: { ...(body as EventInput), id: 1 } }),
    })
    renderApp(<Calendar />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'New event' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Title'), 'Holiday')
    await user.click(within(dialog).getByLabelText('All day'))
    await user.clear(within(dialog).getByLabelText('Start'))
    await user.type(within(dialog).getByLabelText('Start'), '2026-12-24')
    await user.clear(within(dialog).getByLabelText('End'))
    await user.type(within(dialog).getByLabelText('End'), '2026-12-26')
    await user.click(within(dialog).getByRole('button', { name: 'Add event' }))

    const sent = lastBody(fetchMock, 'POST /api/events') as EventInput
    expect(sent.reminder_minutes).toBeNull()
    expect(sent.all_day).toBe(true)
    expect(new Date(sent.starts_at)).toEqual(new Date(2026, 11, 24, 0, 0))
    expect(new Date(sent.ends_at)).toEqual(new Date(2026, 11, 26, 23, 59))
  })

  it('rejects an end before the start without calling the server', async () => {
    const fetchMock = mockApi({ ...ME, 'GET /api/events': { body: { items: [] } } })
    renderApp(<Calendar />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'New event' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Title'), 'Backwards')
    await user.clear(within(dialog).getByLabelText('Start'))
    await user.type(within(dialog).getByLabelText('Start'), '2026-12-24T10:00')
    await user.clear(within(dialog).getByLabelText('End'))
    await user.type(within(dialog).getByLabelText('End'), '2026-12-24T09:00')
    await user.click(within(dialog).getByRole('button', { name: 'Add event' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('must not be before')
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('opens an event for editing with its reminder selected', async () => {
    const fetchMock = mockApi({
      ...ME,
      'GET /api/events': { body: { items: [eventThisMonth()] } },
      'PATCH /api/events/7': { body: eventThisMonth({ reminder_minutes: 1440 }) },
    })
    renderApp(<Calendar />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /Team meeting/ }))
    const dialog = screen.getByRole('dialog', { name: 'Edit event' })
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Team meeting')
    expect(within(dialog).getByLabelText('Email reminder')).toHaveValue('30')

    await user.selectOptions(within(dialog).getByLabelText('Email reminder'), '1 day before')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect((lastBody(fetchMock, 'PATCH /api/events/7') as EventInput).reminder_minutes).toBe(1440)
  })
})
