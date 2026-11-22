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
    repeat: 'none',
    repeat_until: null,
    recipient_ids: [],
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

describe('Calendar: repeating events', () => {
  it('shows a weekly event on every week of the month', async () => {
    const now = new Date()
    const first = new Date(now.getFullYear(), now.getMonth(), 1, 9, 0)
    mockApi({
      ...ME,
      'GET /api/events': {
        body: {
          items: [
            eventThisMonth({
              title: 'Stand-up',
              starts_at: first.toISOString(),
              ends_at: new Date(first.getTime() + 30 * 60000).toISOString(),
              repeat: 'weekly',
            }),
          ],
        },
      },
    })
    renderApp(<Calendar />)

    const shown = await screen.findAllByRole('button', { name: /Stand-up/ })
    // 6 visible weeks, starting no later than the week of the 1st
    expect(shown.length).toBeGreaterThanOrEqual(5)
    const dates = shown.map((button) => within(button.closest('[role="gridcell"]') as HTMLElement).getByText(/^\d+$/).textContent)
    expect(dates.slice(0, 2)).toEqual(['1', '8'])
  })

  it('stops showing occurrences after "repeat until"', async () => {
    const now = new Date()
    const first = new Date(now.getFullYear(), now.getMonth(), 1, 9, 0)
    const until = new Date(now.getFullYear(), now.getMonth(), 3)
    const pad = (n: number) => String(n).padStart(2, '0')
    mockApi({
      ...ME,
      'GET /api/events': {
        body: {
          items: [
            eventThisMonth({
              title: 'Course',
              starts_at: first.toISOString(),
              ends_at: new Date(first.getTime() + 60 * 60000).toISOString(),
              repeat: 'daily',
              repeat_until: `${until.getFullYear()}-${pad(until.getMonth() + 1)}-${pad(until.getDate())}`,
            }),
          ],
        },
      },
    })
    renderApp(<Calendar />)
    expect(await screen.findAllByRole('button', { name: /Course/ })).toHaveLength(3)
  })

  it('saves the repeat and its end date', async () => {
    const fetchMock = mockApi({
      ...ME,
      'GET /api/events': { body: { items: [] } },
      'POST /api/events': (body) => ({ status: 201, body: { ...(body as EventInput), id: 1 } }),
    })
    renderApp(<Calendar />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'New event' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Title'), 'Yoga')
    await user.clear(within(dialog).getByLabelText('Start'))
    await user.type(within(dialog).getByLabelText('Start'), '2026-12-01T18:00')
    await user.clear(within(dialog).getByLabelText('End'))
    await user.type(within(dialog).getByLabelText('End'), '2026-12-01T19:00')
    expect(within(dialog).queryByLabelText('Repeat until (optional)')).not.toBeInTheDocument()
    await user.selectOptions(within(dialog).getByLabelText('Repeat'), 'Every week')
    await user.type(within(dialog).getByLabelText('Repeat until (optional)'), '2027-03-01')
    await user.click(within(dialog).getByRole('button', { name: 'Add event' }))

    const sent = lastBody(fetchMock, 'POST /api/events') as EventInput
    expect(sent.repeat).toBe('weekly')
    expect(sent.repeat_until).toBe('2027-03-01')
  })

  it('says that editing or deleting a repeating event affects every occurrence', async () => {
    mockApi({ ...ME, 'GET /api/events': { body: { items: [eventThisMonth({ repeat: 'monthly' })] } } })
    renderApp(<Calendar />)
    const user = userEvent.setup()

    await user.click((await screen.findAllByRole('button', { name: /Team meeting/ }))[0])
    const dialog = screen.getByRole('dialog', { name: 'Edit event' })
    expect(within(dialog).getByText(/Changes apply to every occurrence/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Delete this event' }))
    expect(screen.getByRole('dialog', { name: 'Delete event' })).toHaveTextContent('and all its repeats')
  })
})

describe('Calendar: week and day views', () => {
  it('switches to a week of seven days and a single day', async () => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 0)
    mockApi({
      ...ME,
      'GET /api/events': {
        body: {
          items: [
            eventThisMonth({
              starts_at: today.toISOString(),
              ends_at: new Date(today.getTime() + 60 * 60000).toISOString(),
            }),
          ],
        },
      },
    })
    renderApp(<Calendar />)
    const user = userEvent.setup()
    await screen.findByRole('button', { name: /Team meeting/ })

    await user.click(screen.getByRole('button', { name: 'Week' }))
    expect(screen.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
    expect(screen.getAllByRole('region')).toHaveLength(7)
    // The detailed entry shows the place and the time range
    const entry = screen.getByRole('button', { name: /Team meeting/ })
    expect(entry).toHaveTextContent('Room 1')
    expect(entry).toHaveTextContent('–')
    expect(screen.getByRole('button', { name: 'Next week' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Day' }))
    expect(screen.getAllByRole('region')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Team meeting/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next day' }))
    expect(screen.queryByRole('button', { name: /Team meeting/ })).not.toBeInTheDocument()
    expect(screen.getByText('No events')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Today' }))
    expect(screen.getByRole('button', { name: /Team meeting/ })).toBeInTheDocument()
  })
})

describe('Calendar: inviting recipients', () => {
  const RECIPIENTS = [
    { id: 1, first_name: 'Ana', last_name: 'Kovač', email: 'ana@example.com', address: '', country: '', mobile: '' },
    { id: 2, first_name: 'Bo', last_name: '', email: 'bo@example.com', address: '', country: '', mobile: '' },
  ]

  it('invites the chosen recipients', async () => {
    const fetchMock = mockApi({
      ...ME,
      'GET /api/events': { body: { items: [] } },
      'GET /api/recipients': { body: { items: RECIPIENTS } },
      'POST /api/events': (body) => ({ status: 201, body: { ...(body as EventInput), id: 1 } }),
    })
    renderApp(<Calendar />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'New event' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Title'), 'Review')
    const invite = await within(dialog).findByRole('group', { name: 'Invite' })
    await user.click(within(invite).getByRole('checkbox', { name: /Bo/ }))
    expect(within(dialog).getByText(/and to the people you invite/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Add event' }))

    expect((lastBody(fetchMock, 'POST /api/events') as EventInput).recipient_ids).toEqual([2])
  })

  it('shows who is already invited and can remove them', async () => {
    const fetchMock = mockApi({
      ...ME,
      'GET /api/events': { body: { items: [eventThisMonth({ recipient_ids: [1, 2] })] } },
      'GET /api/recipients': { body: { items: RECIPIENTS } },
      'PATCH /api/events/7': { body: eventThisMonth({ recipient_ids: [2] }) },
    })
    renderApp(<Calendar />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /Team meeting/ }))
    const dialog = screen.getByRole('dialog')
    const ana = await within(dialog).findByRole('checkbox', { name: /Ana Kovač/ })
    expect(ana).toBeChecked()
    await user.click(ana)
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect((lastBody(fetchMock, 'PATCH /api/events/7') as EventInput).recipient_ids).toEqual([2])
  })

  it('points to Recipients when there is nobody to invite', async () => {
    mockApi({
      ...ME,
      'GET /api/events': { body: { items: [] } },
      'GET /api/recipients': { body: { items: [] } },
    })
    renderApp(<Calendar />)

    await userEvent.click(screen.getByRole('button', { name: 'New event' }))
    const dialog = screen.getByRole('dialog')
    expect(await within(dialog).findByRole('link', { name: 'Recipients' })).toHaveAttribute('href', '/recipients')
  })
})
