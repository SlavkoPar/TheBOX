import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { REPEAT_LABELS, eventsApi, friendsApi } from '../api'
import type { CalendarEvent, EventInput, Friend, Repeat } from '../api'
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
import { endOfDay, occurrencesByDay, startOfDay, startOfWeek } from '../common/recurrence'
import type { Occurrence } from '../common/recurrence'
import { useCollection } from '../common/useCollection'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const REPEATS = Object.keys(REPEAT_LABELS) as Repeat[]

type Mode = 'month' | 'week' | 'day'
const MODES: { id: Mode; label: string }[] = [
  { id: 'month', label: 'Month' },
  { id: 'week', label: 'Week' },
  { id: 'day', label: 'Day' },
]

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
  /** null while loading or if they could not be loaded */
  friends: Friend[] | null
  onClose: () => void
  onSave: (data: EventInput) => Promise<unknown>
  onDelete?: () => void
}

function EventForm({ draft, friends, onClose, onSave, onDelete }: FormProps) {
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
  const [repeat, setRepeat] = useState<Repeat>(existing?.repeat ?? 'none')
  const [repeatUntil, setRepeatUntil] = useState(existing?.repeat_until ?? '')
  const [invited, setInvited] = useState<Set<number>>(new Set(existing?.friend_ids ?? []))

  // An existing reminder that is not one of the standard choices stays selectable.
  const options = useMemo(() => {
    const current = existing?.reminder_minutes
    if (current == null || REMINDER_OPTIONS.some((o) => o.minutes === current)) {
      return REMINDER_OPTIONS
    }
    return [...REMINDER_OPTIONS, { minutes: current, label: `${current} minutes before` }]
  }, [existing])

  function toggleInvite(id: number) {
    const next = new Set(invited)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setInvited(next)
  }

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
    if (repeat !== 'none' && repeatUntil && repeatUntil < dateKey(startsAt)) {
      return Promise.reject(new Error('“Repeat until” must not be before the start.'))
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
      repeat,
      repeat_until: repeat !== 'none' && repeatUntil ? repeatUntil : null,
      friend_ids: [...invited],
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
      <div className="form-row">
        <label>
          Repeat
          <select value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}>
            {REPEATS.map((value) => (
              <option key={value} value={value}>
                {REPEAT_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        {repeat !== 'none' && (
          <label>
            Repeat until (optional)
            <input type="date" value={repeatUntil} onChange={(e) => setRepeatUntil(e.target.value)} />
          </label>
        )}
      </div>
      {existing && existing.repeat !== 'none' && (
        <p className="hint">Changes apply to every occurrence of this repeating event.</p>
      )}
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

      {friends && friends.length > 0 && (
        <fieldset className="friend-picker">
          <legend>Invite</legend>
          {friends.map((friend) => (
            <label className="check" key={friend.id}>
              <input
                type="checkbox"
                checked={invited.has(friend.id)}
                onChange={() => toggleInvite(friend.id)}
              />
              <span>
                {`${friend.first_name} ${friend.last_name}`.trim()} <small>{friend.email}</small>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {friends && friends.length === 0 && (
        <p className="hint">
          To invite people, first add them in <Link to="/friends">Friends</Link>.
        </p>
      )}
      <p className="hint">
        The reminder is emailed to you{invited.size > 0 ? ' and to the people you invite' : ''}. Invited
        people also get an invitation email when you save.
      </p>

      {onDelete && (
        <button type="button" className="link-button danger-text" onClick={onDelete}>
          Delete this event
        </button>
      )}
    </FormModal>
  )
}

function shiftCursor(cursor: Date, mode: Mode, by: number): Date {
  if (mode === 'month') return new Date(cursor.getFullYear(), cursor.getMonth() + by, 1)
  const next = new Date(cursor)
  next.setDate(cursor.getDate() + (mode === 'week' ? 7 * by : by))
  return next
}

function rangeTitle(cursor: Date, mode: Mode): string {
  if (mode === 'month') return cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  if (mode === 'day') {
    return cursor.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  }
  const first = startOfWeek(cursor)
  const last = new Date(first)
  last.setDate(first.getDate() + 6)
  const day = (date: Date, withYear: boolean) =>
    date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) })
  return `${day(first, false)} – ${day(last, true)}`
}

function timeRange({ event, start, end }: Occurrence): string {
  if (event.all_day) return 'All day'
  return `${formatTime(start)} – ${formatTime(end)}`
}

export default function Calendar() {
  const { items, loading, error, create, update, remove } = useCollection(eventsApi)
  const [mode, setMode] = useState<Mode>('month')
  const [cursor, setCursor] = useState(() => startOfDay(new Date()))
  const [draft, setDraft] = useState<Draft | null>(null)
  const [deleting, setDeleting] = useState<CalendarEvent | null>(null)
  const [friends, setFriends] = useState<Friend[] | null>(null)
  const [todayKey] = useState(() => dateKey(new Date()))

  // Inviting is optional: if friends cannot be loaded the calendar still works.
  useEffect(() => {
    let cancelled = false
    friendsApi.list().then(
      (loaded) => {
        if (!cancelled) setFriends(loaded)
      },
      () => undefined,
    )
    return () => {
      cancelled = true
    }
  }, [])

  const days = useMemo(() => {
    if (mode === 'month') return monthGrid(cursor.getFullYear(), cursor.getMonth())
    if (mode === 'day') return [startOfDay(cursor)]
    const first = startOfWeek(cursor)
    return Array.from({ length: 7 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i))
  }, [mode, cursor])

  const byDay = useMemo(
    () => occurrencesByDay(items, days[0], endOfDay(days[days.length - 1])),
    [items, days],
  )

  function newEventOn(day: Date) {
    const start = new Date(day)
    start.setHours(9, 0, 0, 0)
    const end = new Date(start)
    end.setHours(10)
    setDraft({ event: null, start, end })
  }

  function edit(event: CalendarEvent) {
    // A repeating event is edited as a whole, from its first occurrence.
    setDraft({ event, start: new Date(event.starts_at), end: new Date(event.ends_at) })
  }

  function eventButton(occurrence: Occurrence, key: string, detailed: boolean) {
    const { event, start } = occurrence
    const startsToday = dateKey(start) === key
    return (
      <button
        type="button"
        className={detailed ? 'calendar-event detailed' : 'calendar-event'}
        key={`${event.id}-${start.getTime()}`}
        title={event.title}
        onClick={() => edit(event)}
      >
        {detailed ? (
          <span className="event-time">{timeRange(occurrence)}</span>
        ) : (
          !event.all_day && startsToday && <span className="event-time">{formatTime(start)}</span>
        )}
        <span className="event-title">{event.title}</span>
        {detailed && event.location && <span className="event-place">{event.location}</span>}
        {event.repeat !== 'none' && <Icon name="repeat" size={12} />}
        {event.reminder_minutes != null && <Icon name="bell" size={12} />}
      </button>
    )
  }

  const addLabel = (day: Date) =>
    `Add event on ${day.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}`

  return (
    <div className="page">
      <div className="page-header">
        <div className="calendar-nav">
          <button type="button" className="icon-button" aria-label={`Previous ${mode}`} onClick={() => setCursor(shiftCursor(cursor, mode, -1))}>
            <Icon name="left" />
          </button>
          <h2 aria-live="polite">{rangeTitle(cursor, mode)}</h2>
          <button type="button" className="icon-button" aria-label={`Next ${mode}`} onClick={() => setCursor(shiftCursor(cursor, mode, 1))}>
            <Icon name="right" />
          </button>
          <button type="button" className="secondary" onClick={() => setCursor(startOfDay(new Date()))}>
            Today
          </button>
        </div>
        <div className="toolbar">
          <div className="segmented" role="group" aria-label="View">
            {MODES.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={mode === id ? undefined : 'secondary'}
                aria-pressed={mode === id}
                onClick={() => setMode(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => newEventOn(mode === 'month' ? new Date() : cursor)}>
            <Icon name="plus" size={18} /> New event
          </button>
        </div>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading && <p>Loading…</p>}

      {mode === 'month' && (
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
                const classes = ['calendar-day']
                if (day.getMonth() !== cursor.getMonth()) classes.push('other-month')
                if (key === todayKey) classes.push('today')
                return (
                  <div className={classes.join(' ')} role="gridcell" key={key}>
                    <button type="button" className="day-number" aria-label={addLabel(day)} onClick={() => newEventOn(day)}>
                      {day.getDate()}
                    </button>
                    {(byDay.get(key) ?? []).map((occurrence) => eventButton(occurrence, key, false))}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {mode !== 'month' && (
        <div className={mode === 'week' ? 'agenda agenda-week' : 'agenda'}>
          {days.map((day) => {
            const key = dateKey(day)
            const list = byDay.get(key) ?? []
            const name = day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
            return (
              <section key={key} className={key === todayKey ? 'agenda-day today' : 'agenda-day'} aria-label={name}>
                <header>
                  <h3>
                    {day.toLocaleDateString(undefined, { weekday: 'short' })}{' '}
                    <span className="agenda-date">{day.getDate()}</span>
                  </h3>
                  <button type="button" className="icon-button" aria-label={addLabel(day)} onClick={() => newEventOn(day)}>
                    <Icon name="plus" size={18} />
                  </button>
                </header>
                {list.length === 0 ? (
                  <p className="hint">No events</p>
                ) : (
                  list.map((occurrence) => eventButton(occurrence, key, true))
                )}
              </section>
            )
          })}
        </div>
      )}

      {draft && (
        <EventForm
          key={draft.event?.id ?? 'new'}
          draft={draft}
          friends={friends}
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
          message={
            deleting.repeat === 'none'
              ? `Delete “${deleting.title}”?`
              : `Delete “${deleting.title}” and all its repeats?`
          }
          confirmLabel="Delete"
          onClose={() => setDeleting(null)}
          onConfirm={() => remove(deleting.id)}
        />
      )}
    </div>
  )
}
