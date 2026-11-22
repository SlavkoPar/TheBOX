import { useMemo, useState } from 'react'
import { eventsApi } from '../api'
import type { CalendarEvent, EventInput } from '../api'
import { ConfirmDialog, FormModal } from '../common/Modal'
import {
  browserTimeZone,
  dateKey,
  formatTime,
  monthGrid,
  parseDateKey,
  toLocalInput,
} from '../common/format'
import { Icon } from '../common/icons'
import { useCollection } from '../common/useCollection'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Choices for "email me a reminder" — minutes before the event starts. */
const REMINDER_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 0, label: 'At the start' },
  { minutes: 5, label: '5 minutes before' },
  { minutes: 10, label: '10 minutes before' },
  { minutes: 15, label: '15 minutes before' },
  { minutes: 30, label: '30 minutes before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 120, label: '2 hours before' },
  { minutes: 60 * 24, label: '1 day before' },
  { minutes: 60 * 24 * 2, label: '2 days before' },
  { minutes: 60 * 24 * 7, label: '1 week before' },
]

type Draft = { event: CalendarEvent | null; start: Date; end: Date }

type FormProps = {
  draft: Draft
  onClose: () => void
  onSave: (data: EventInput) => Promise<unknown>
  onDelete?: () => void
}

function EventForm({ draft, onClose, onSave, onDelete }: FormProps) {
  const existing = draft.event
  const [title, setTitle] = useState(existing?.title ?? '')
  const [allDay, setAllDay] = useState(existing?.all_day ?? false)
  const [start, setStart] = useState(toLocalInput(draft.start))
  const [end, setEnd] = useState(toLocalInput(draft.end))
  const [location, setLocation] = useState(existing?.location ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [reminder, setReminder] = useState(
    existing?.reminder_minutes == null ? '' : String(existing.reminder_minutes),
  )

  // An existing reminder that is not one of the standard choices stays selectable.
  const options = useMemo(() => {
    const current = existing?.reminder_minutes
    if (current == null || REMINDER_OPTIONS.some((o) => o.minutes === current)) {
      return REMINDER_OPTIONS
    }
    return [...REMINDER_OPTIONS, { minutes: current, label: `${current} minutes before` }]
  }, [existing])

  function submit() {
    let startsAt: Date
    let endsAt: Date
    if (allDay) {
      // Whole local days: from midnight of the first day to the end of the last.
      startsAt = parseDateKey(start.slice(0, 10))
      endsAt = parseDateKey(end.slice(0, 10))
      endsAt.setHours(23, 59, 0, 0)
    } else {
      startsAt = new Date(start)
      endsAt = new Date(end)
    }
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      return Promise.reject(new Error('Enter a start and an end.'))
    }
    if (endsAt < startsAt) {
      return Promise.reject(new Error('The end must not be before the start.'))
    }
    return onSave({
      title,
      description,
      location,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      all_day: allDay,
      timezone: browserTimeZone(),
      reminder_minutes: reminder === '' ? null : Number(reminder),
    })
  }

  const inputType = allDay ? 'date' : 'datetime-local'
  const shown = (value: string) => (allDay ? value.slice(0, 10) : value)
  const stored = (value: string, previous: string) =>
    allDay ? `${value}T${previous.slice(11) || '09:00'}` : value

  return (
    <FormModal
      title={existing ? 'Edit event' : 'New event'}
      submitLabel={existing ? 'Save' : 'Add event'}
      onClose={onClose}
      onSubmit={submit}
    >
      <label>
        Title
        <input value={title} required autoFocus onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
        All day
      </label>
      <div className="form-row">
        <label>
          Start
          <input
            type={inputType}
            value={shown(start)}
            required
            onChange={(e) => setStart(stored(e.target.value, start))}
          />
        </label>
        <label>
          End
          <input
            type={inputType}
            value={shown(end)}
            required
            onChange={(e) => setEnd(stored(e.target.value, end))}
          />
        </label>
      </div>
      <label>
        Location
        <input value={location} onChange={(e) => setLocation(e.target.value)} />
      </label>
      <label>
        Description
        <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label>
        Email reminder
        <select value={reminder} onChange={(e) => setReminder(e.target.value)}>
          <option value="">No reminder</option>
          {options.map((option) => (
            <option key={option.minutes} value={option.minutes}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">The reminder is emailed to your account's address.</p>
      {onDelete && (
        <button type="button" className="link-button danger-text" onClick={onDelete}>
          Delete this event
        </button>
      )}
    </FormModal>
  )
}

/** Events for each local day they cover, keyed by YYYY-MM-DD. */
function eventsByDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const days = new Map<string, CalendarEvent[]>()
  for (const event of events) {
    const last = new Date(event.ends_at)
    const day = new Date(event.starts_at)
    day.setHours(0, 0, 0, 0)
    // Cap the walk so one bad row cannot loop for ever.
    for (let i = 0; i < 370 && day <= last; i += 1) {
      const key = dateKey(day)
      days.set(key, [...(days.get(key) ?? []), event])
      day.setDate(day.getDate() + 1)
    }
  }
  return days
}

export default function Calendar() {
  const { items, loading, error, create, update, remove } = useCollection(eventsApi)
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [deleting, setDeleting] = useState<CalendarEvent | null>(null)

  const days = useMemo(() => monthGrid(month.getFullYear(), month.getMonth()), [month])
  const byDay = useMemo(() => eventsByDay(items), [items])
  const [todayKey] = useState(() => dateKey(new Date()))

  function shift(months: number) {
    setMonth(new Date(month.getFullYear(), month.getMonth() + months, 1))
  }

  function newEventOn(day: Date) {
    const start = new Date(day)
    start.setHours(9, 0, 0, 0)
    const end = new Date(start)
    end.setHours(10)
    setDraft({ event: null, start, end })
  }

  function edit(event: CalendarEvent) {
    setDraft({ event, start: new Date(event.starts_at), end: new Date(event.ends_at) })
  }

  return (
    <div className="page">
      <div className="page-header">
        <div className="calendar-nav">
          <button type="button" className="icon-button" aria-label="Previous month" onClick={() => shift(-1)}>
            <Icon name="left" />
          </button>
          <h2 aria-live="polite">
            {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </h2>
          <button type="button" className="icon-button" aria-label="Next month" onClick={() => shift(1)}>
            <Icon name="right" />
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              const now = new Date()
              setMonth(new Date(now.getFullYear(), now.getMonth(), 1))
            }}
          >
            Today
          </button>
        </div>
        <button type="button" onClick={() => newEventOn(new Date())}>
          <Icon name="plus" size={18} /> New event
        </button>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading && <p>Loading…</p>}

      <div className="calendar" role="grid" aria-label="Month">
        <div className="calendar-row calendar-head" role="row">
          {WEEKDAYS.map((name) => (
            <div key={name} role="columnheader">
              {name}
            </div>
          ))}
        </div>
        {Array.from({ length: 6 }, (_, week) => (
          <div className="calendar-row" role="row" key={week}>
            {days.slice(week * 7, week * 7 + 7).map((day) => {
              const key = dateKey(day)
              const dayEvents = byDay.get(key) ?? []
              const classes = ['calendar-day']
              if (day.getMonth() !== month.getMonth()) classes.push('other-month')
              if (key === todayKey) classes.push('today')
              return (
                <div className={classes.join(' ')} role="gridcell" key={key}>
                  <button
                    type="button"
                    className="day-number"
                    aria-label={`Add event on ${day.toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'long',
                    })}`}
                    onClick={() => newEventOn(day)}
                  >
                    {day.getDate()}
                  </button>
                  {dayEvents.map((event) => (
                    <button
                      type="button"
                      className="calendar-event"
                      key={event.id}
                      title={event.title}
                      onClick={() => edit(event)}
                    >
                      {!event.all_day && dateKey(new Date(event.starts_at)) === key && (
                        <span className="event-time">{formatTime(event.starts_at)}</span>
                      )}
                      <span className="event-title">{event.title}</span>
                      {event.reminder_minutes != null && <Icon name="bell" size={12} />}
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {draft && (
        <EventForm
          key={draft.event?.id ?? 'new'}
          draft={draft}
          onClose={() => setDraft(null)}
          onSave={(data) => (draft.event ? update(draft.event.id, data) : create(data))}
          onDelete={
            draft.event
              ? () => {
                  setDeleting(draft.event)
                  setDraft(null)
                }
              : undefined
          }
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete event"
          message={`Delete “${deleting.title}”?`}
          confirmLabel="Delete"
          onClose={() => setDeleting(null)}
          onConfirm={() => remove(deleting.id)}
        />
      )}
    </div>
  )
}
