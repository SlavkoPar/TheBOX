import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '../api'
import { columnName, parseCsv, toCsv, toGrid } from './csv'
import { formatBytes } from './format'
import { occurrencesBetween, occurrencesByDay, shiftDate, startOfWeek } from './recurrence'
import { cleanHtml } from './richText'

describe('csv', () => {
  it('parses quoted cells, embedded commas, quotes and line breaks', () => {
    expect(parseCsv('a,b\n"1,200","say ""hi"""\n"two\nlines",x\n')).toEqual([
      ['a', 'b'],
      ['1,200', 'say "hi"'],
      ['two\nlines', 'x'],
    ])
  })

  it('handles Windows line endings, empty cells and no final newline', () => {
    expect(parseCsv('a,,c\r\n,,\r\nlast')).toEqual([['a', '', 'c'], ['', '', ''], ['last']])
    expect(parseCsv('')).toEqual([])
  })

  it('writes what it reads', () => {
    const rows = [['Item', 'Cost'], ['Rent', '1,200'], ['Note', 'say "hi"'], ['Multi', 'two\nlines']]
    expect(parseCsv(toCsv(rows))).toEqual(rows)
    expect(toCsv([])).toBe('')
    expect(toCsv([['a', 'b']])).toBe('a,b\n')
  })

  it('pads rows to a rectangle of a minimum size', () => {
    expect(toGrid([['a'], ['b', 'c', 'd']], 3, 2)).toEqual([
      ['a', '', ''],
      ['b', 'c', 'd'],
      ['', '', ''],
    ])
    expect(toGrid([], 2, 2)).toEqual([['', ''], ['', '']])
  })

  it('names columns like a spreadsheet', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual([
      'A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA',
    ])
  })
})

describe('cleanHtml', () => {
  it('keeps simple formatting', () => {
    const html = '<h2>Title</h2><p>Some <b>bold</b>, <i>italic</i> and <u>underlined</u> text.</p><ul><li>one</li></ul>'
    expect(cleanHtml(html)).toBe(html)
  })

  it('removes scripts, event handlers, styles, images and frames', () => {
    expect(cleanHtml('<p onclick="x()">hi</p><script>x()</script>')).toBe('<p>hi</p>')
    expect(cleanHtml('<img src="x" onerror="x()"><iframe src="//evil"></iframe>ok')).toBe('ok')
    expect(cleanHtml('<p style="position:fixed">x</p><style>p{}</style>')).toBe('<p>x</p>')
  })

  it('keeps ordinary links and drops script links', () => {
    expect(cleanHtml('<a href="https://example.com">site</a>')).toBe('<a href="https://example.com">site</a>')
    expect(cleanHtml('<a href="javascript:x()">bad</a>')).toBe('<a>bad</a>')
  })
})

describe('formatBytes', () => {
  it('uses the largest sensible unit', () => {
    expect([0, 512, 2048, 5 * 1024 * 1024, 500 * 1024 * 1024, 3 * 1024 ** 3].map(formatBytes)).toEqual([
      '0 B', '512 B', '2.0 KB', '5.0 MB', '500 MB', '3.0 GB',
    ])
  })
})

function event(extra: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 1,
    title: 'Event',
    description: '',
    location: '',
    starts_at: new Date(2026, 0, 31, 9, 0).toISOString(),
    ends_at: new Date(2026, 0, 31, 10, 0).toISOString(),
    all_day: false,
    timezone: 'UTC',
    reminder_minutes: null,
    reminder_sent_at: null,
    repeat: 'none',
    repeat_until: null,
    friend_ids: [],
    ...extra,
  }
}

const local = (date: Date) => [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours()]

describe('recurrence', () => {
  it('shifts dates, clamping to the length of the month', () => {
    const base = new Date(2026, 0, 31, 9, 0)
    expect(local(shiftDate(base, 'daily', 1))).toEqual([2026, 2, 1, 9])
    expect(local(shiftDate(base, 'weekly', 2))).toEqual([2026, 2, 14, 9])
    expect(local(shiftDate(base, 'monthly', 1))).toEqual([2026, 2, 28, 9])
    expect(local(shiftDate(base, 'monthly', 2))).toEqual([2026, 3, 31, 9]) // the clamp does not stick
    expect(local(shiftDate(base, 'monthly', 12))).toEqual([2027, 1, 31, 9])
    expect(local(shiftDate(new Date(2024, 1, 29, 9, 0), 'yearly', 1))).toEqual([2025, 2, 28, 9])
  })

  it('finds a single event only when it overlaps the range', () => {
    const single = event({})
    expect(occurrencesBetween(single, new Date(2026, 0, 1), new Date(2026, 1, 1))).toHaveLength(1)
    expect(occurrencesBetween(single, new Date(2026, 1, 1), new Date(2026, 2, 1))).toHaveLength(0)
  })

  it('expands repeats inside the range, even years after the start', () => {
    const daily = event({ repeat: 'daily' })
    const found = occurrencesBetween(daily, new Date(2030, 5, 1), new Date(2030, 5, 7, 23, 59))
    expect(found.map((o) => o.start.getDate())).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(found.every((o) => o.start.getHours() === 9)).toBe(true)

    const monthly = event({ repeat: 'monthly' })
    const year = occurrencesBetween(monthly, new Date(2026, 0, 1), new Date(2026, 11, 31, 23, 59))
    expect(year.map((o) => o.start.getDate())).toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])
  })

  it('honours "repeat until" (inclusive) and never shows anything before the first occurrence', () => {
    const limited = event({ repeat: 'weekly', repeat_until: '2026-02-14' })
    const found = occurrencesBetween(limited, new Date(2025, 0, 1), new Date(2027, 0, 1))
    expect(found.map((o) => local(o.start).slice(0, 3))).toEqual([
      [2026, 1, 31],
      [2026, 2, 7],
      [2026, 2, 14],
    ])
  })

  it('lists a multi-day event on each day it covers, all-day events first', () => {
    const trip = event({
      id: 2,
      title: 'Trip',
      starts_at: new Date(2026, 5, 10, 0, 0).toISOString(),
      ends_at: new Date(2026, 5, 12, 23, 59).toISOString(),
      all_day: true,
    })
    const call = event({
      id: 3,
      title: 'Call',
      starts_at: new Date(2026, 5, 11, 8, 0).toISOString(),
      ends_at: new Date(2026, 5, 11, 8, 30).toISOString(),
    })
    const days = occurrencesByDay([call, trip], new Date(2026, 5, 1), new Date(2026, 5, 30, 23, 59))
    expect([...days.keys()].sort()).toEqual(['2026-06-10', '2026-06-11', '2026-06-12'])
    expect(days.get('2026-06-11')!.map((o) => o.event.title)).toEqual(['Trip', 'Call'])
  })

  it('starts the week on Monday', () => {
    expect(local(startOfWeek(new Date(2026, 10, 22, 15, 0)))).toEqual([2026, 11, 16, 0]) // a Sunday
    expect(local(startOfWeek(new Date(2026, 10, 16, 15, 0)))).toEqual([2026, 11, 16, 0]) // a Monday
  })
})
