// Files and folders chosen for a package.

import type { FileApp } from '../api'

/** A file or folder chosen for a package, with enough to show it without loading it again. */
export type PickedItem = {
  kind: 'file' | 'folder'
  id: number
  app: FileApp
  name: string
  /** the folder it is in, e.g. "Work / Reports"; "" for the top level */
  path: string
}

export const FILE_APP_NAMES: Record<FileApp, string> = { drive: 'Drive', photos: 'Photos' }

/** "Drive / Work / Reports" */
export function locationOf(item: { app: FileApp; path: string }): string {
  return [FILE_APP_NAMES[item.app], item.path].filter(Boolean).join(' / ')
}

export const itemKey = (item: Pick<PickedItem, 'kind' | 'id'>) => `${item.kind}-${item.id}`
