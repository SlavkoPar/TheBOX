// Occurrences of repeating calendar events, for display.
// (The server has the same rules in app/recurrence.py, for reminders.)

import type { CalendarEvent, Repeat } from '../api'
import { dateKey } from './format'

export type Occurrence = { event: CalendarEvent; start: Date; end: Date }

const DAY_MS = 24 * 60 * 60 * 1000

/** `base` moved `n` periods on, keeping the local time of day. */
export function shiftDate(base: Date, repeat: Repeat, n: number): Date {
  const date = new Date(base)
  if (repeat === 'daily') date.setDate(base.getDate() + n)
  else if (repeat === 'weekly') date.setDate(base.getDate() + 7 * n)
  else if (repeat === 'monthly' || repeat === 'yearly') {
    const months = base.getMonth() + (repeat === 'monthly' ? n : 12 * n)
    // Day 1 first, so a short month cannot overflow into the next one...
    date.setFullYear(base.getFullYear(), months, 1)
    // ...then the original day, clamped to the month's length (31 Jan -> 28 Feb).
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
    date.setDate(Math.min(base.getDate(), lastDay))
  }
  return date
}

/** Every occurrence of the event that overlaps [from, to]. */
export function occurrencesBetween(event: CalendarEvent, from: Date, to: Date): Occurrence[] {
  const first = new Date(event.starts_at)
  const duration = new Date(event.ends_at).getTime() - first.getTime()
  const overlaps = (start: Date) => start <= to && start.getTime() + duration >= from.getTime()

  if (event.repeat === 'none') {
    return overlaps(first) ? [{ event, start: first, end: new Date(first.getTime() + duration) }] : []
  }

  // Start a little before the window instead of walking from the first occurrence.
  const days = Math.floor((from.getTime() - duration - first.getTime()) / DAY_MS)
  const period = { daily: 1, weekly: 7, monthly: 31, yearly: 366 }[event.repeat]
  let n = Math.max(0, Math.floor(days / period) - 1)

  const found: Occurrence[] = []
  for (let guard = 0; guard < 800; guard += 1, n += 1) {
    const start = shiftDate(first, event.repeat, n)
    if (start > to) break
    if (event.repeat_until && dateKey(start) > event.repeat_until) break
    if (overlaps(start)) found.push({ event, start, end: new Date(start.getTime() + duration) })
  }
  return found
}

/** Occurrences for each local day they cover, keyed by YYYY-MM-DD and sorted by start. */
export function occurrencesByDay(events: CalendarEvent[], from: Date, to: Date): Map<string, Occurrence[]> {
  const days = new Map<string, Occurrence[]>()
  for (const event of events) {
    for (const occurrence of occurrencesBetween(event, from, to)) {
      const day = new Date(occurrence.start)
      day.setHours(0, 0, 0, 0)
      // Cap the walk so one bad row cannot loop for ever.
      for (let i = 0; i < 370 && day <= occurrence.end; i += 1) {
        if (day >= startOfDay(from) && day <= to) {
          const key = dateKey(day)
          days.set(key, [...(days.get(key) ?? []), occurrence])
        }
        day.setDate(day.getDate() + 1)
      }
    }
  }
  for (const list of days.values()) {
    list.sort((a, b) => Number(b.event.all_day) - Number(a.event.all_day) || a.start.getTime() - b.start.getTime())
  }
  return days
}

export function startOfDay(date: Date): Date {
  const day = new Date(date)
  day.setHours(0, 0, 0, 0)
  return day
}

export function endOfDay(date: Date): Date {
  const day = new Date(date)
  day.setHours(23, 59, 59, 999)
  return day
}

/** Monday of the week the date is in. */
export function startOfWeek(date: Date): Date {
  const day = startOfDay(date)
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7))
  return day
}
