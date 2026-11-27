import type { Summary, User } from './api'
import type { IconName } from './common/icons'

export type AppInfo = {
  id: string
  name: string
  path: string
  icon: IconName
  description: string
  /** shown to administrators only */
  adminOnly?: boolean
}

/** The apps, in menu order. The apps menu, the home page and the header all read this list. */
export const APPS: AppInfo[] = [
  { id: 'drive', name: 'Drive', path: '/drive', icon: 'drive', description: 'Folders and documents' },
  { id: 'photos', name: 'Photos', path: '/photos', icon: 'photos', description: 'Albums and pictures' },
  { id: 'tasks', name: 'Tasks', path: '/tasks', icon: 'tasks', description: 'To-do list with due dates' },
  { id: 'calendar', name: 'Calendar', path: '/calendar', icon: 'calendar', description: 'Events and email reminders' },
  { id: 'packages', name: 'Packages', path: '/packages', icon: 'packages', description: 'Files sent to friends' },
  { id: 'friends', name: 'Friends', path: '/friends', icon: 'friends', description: 'People you share with' },
  { id: 'messenger', name: 'Messenger', path: '/messenger', icon: 'chat', description: 'Chat with your friends' },
  { id: 'users', name: 'Users', path: '/users', icon: 'user', description: 'Everyone who registered', adminOnly: true },
]

/** The apps this user gets in the menu and on the home page. */
export function appsFor(user: User | null): AppInfo[] {
  return APPS.filter((app) => !app.adminOnly || user?.is_admin)
}

export function appForPath(pathname: string): AppInfo | undefined {
  return APPS.find((app) => pathname === app.path || pathname.startsWith(`${app.path}/`))
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** What an app holds, in words ("3 folders · 12 documents"); '' while it is not known. */
export function countsFor(appId: string, summary: Summary | null): string {
  const counts = summary?.[appId]
  if (!counts) return ''
  const n = (key: string) => counts[key] ?? 0
  switch (appId) {
    case 'drive':
      return `${plural(n('folders'), 'folder')} · ${plural(n('files'), 'document')}`
    case 'photos':
      return `${plural(n('folders'), 'album')} · ${plural(n('files'), 'photo')}`
    case 'tasks':
      return `${n('open')} open · ${n('done')} done`
    case 'calendar':
      return plural(n('events'), 'event')
    case 'packages':
      return plural(n('packages'), 'package')
    case 'friends':
      return plural(n('friends'), 'friend')
    case 'messenger':
      return n('unread') ? `${n('unread')} unread` : 'No new messages'
    case 'users':
      return plural(n('users'), 'user')
    default:
      return ''
  }
}
