import type { IconName } from './common/icons'

export type AppInfo = {
  id: string
  name: string
  path: string
  icon: IconName
  description: string
}

/** The apps, in menu order. The apps menu, the home page and the header all read this list. */
export const APPS: AppInfo[] = [
  { id: 'drive', name: 'Drive', path: '/drive', icon: 'drive', description: 'Folders and documents' },
  { id: 'photos', name: 'Photos', path: '/photos', icon: 'photos', description: 'Albums and pictures' },
  { id: 'tasks', name: 'Tasks', path: '/tasks', icon: 'tasks', description: 'To-do list with due dates' },
  { id: 'calendar', name: 'Calendar', path: '/calendar', icon: 'calendar', description: 'Events and email reminders' },
  { id: 'recipients', name: 'Recipients', path: '/recipients', icon: 'recipients', description: 'People you share with' },
]

export function appForPath(pathname: string): AppInfo | undefined {
  return APPS.find((app) => pathname === app.path || pathname.startsWith(`${app.path}/`))
}
