import { useEffect, useMemo, useState } from 'react'
import { errorMessage, filesApi } from '../api'
import type { FileApp, Listing } from '../api'
import { Icon } from './icons'
import { FILE_APP_NAMES, itemKey } from './items'
import type { PickedItem } from './items'

type Props = {
  picked: PickedItem[]
  onChange: (picked: PickedItem[]) => void
}

/**
 * Browse Drive and Photos and tick files and folders. The ticks are kept while
 * moving between folders and apps, so items from different places can be chosen.
 */
export default function ItemPicker({ picked, onChange }: Props) {
  const [app, setApp] = useState<FileApp>('drive')
  const [folderId, setFolderId] = useState<number | null>(null)
  const [loaded, setLoaded] = useState<{ app: FileApp; folderId: number | null; listing: Listing } | null>(null)
  const [error, setError] = useState('')
  const api = useMemo(() => filesApi(app), [app])

  useEffect(() => {
    let cancelled = false
    api
      .list(folderId)
      .then((listing) => {
        if (cancelled) return
        setLoaded({ app, folderId, listing })
        setError('')
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [api, app, folderId])

  const listing = loaded && loaded.app === app && loaded.folderId === folderId ? loaded.listing : null
  const path = listing ? listing.breadcrumbs.map((crumb) => crumb.name).join(' / ') : ''
  const keys = new Set(picked.map(itemKey))

  function toggle(item: PickedItem) {
    const key = itemKey(item)
    onChange(keys.has(key) ? picked.filter((other) => itemKey(other) !== key) : [...picked, item])
  }

  function open(nextApp: FileApp, nextFolder: number | null) {
    setApp(nextApp)
    setFolderId(nextFolder)
  }

  const empty = listing !== null && listing.folders.length + listing.files.length === 0

  return (
    <div className="item-picker">
      <div className="toolbar" role="group" aria-label="Choose from">
        {(Object.keys(FILE_APP_NAMES) as FileApp[]).map((name) => (
          <button
            key={name}
            type="button"
            className={name === app ? undefined : 'secondary'}
            aria-pressed={name === app}
            onClick={() => open(name, null)}
          >
            <Icon name={name} size={18} /> {FILE_APP_NAMES[name]}
          </button>
        ))}
      </div>

      <nav className="picker-path" aria-label="Folder path">
        <button type="button" className="link-button" onClick={() => open(app, null)}>
          {FILE_APP_NAMES[app]}
        </button>
        {listing?.breadcrumbs.map((crumb) => (
          <span key={crumb.id} className="crumb">
            <Icon name="right" size={14} />
            <button type="button" className="link-button" onClick={() => open(app, crumb.id)}>
              {crumb.name}
            </button>
          </span>
        ))}
      </nav>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!listing && !error && <p>Loading…</p>}
      {empty && <p className="hint">Nothing here.</p>}

      {listing && !empty && (
        <ul className="picker-list" aria-label="Files and folders">
          {listing.folders.map((folder) => {
            const item: PickedItem = { kind: 'folder', id: folder.id, app, name: folder.name, path }
            return (
              <li key={itemKey(item)}>
                <input
                  type="checkbox"
                  checked={keys.has(itemKey(item))}
                  aria-label={`Select folder ${folder.name}`}
                  onChange={() => toggle(item)}
                />
                <button
                  type="button"
                  className="item-name link-button"
                  aria-label={`Open folder ${folder.name}`}
                  onClick={() => open(app, folder.id)}
                >
                  <Icon name="folder" /> {folder.name}
                </button>
              </li>
            )
          })}
          {listing.files.map((file) => {
            const item: PickedItem = { kind: 'file', id: file.id, app, name: file.name, path }
            return (
              <li key={itemKey(item)}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={keys.has(itemKey(item))}
                    aria-label={`Select ${file.name}`}
                    onChange={() => toggle(item)}
                  />
                  <span className="item-name">
                    <Icon name={file.is_encrypted ? 'lock' : app === 'photos' ? 'photos' : 'file'} />{' '}
                    {file.name}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      )}

      <p className="hint" aria-live="polite">
        {picked.length === 0
          ? 'Tick files and folders. You can open other folders and keep ticking.'
          : `${picked.length} selected. A ticked folder brings everything in it.`}
      </p>
    </div>
  )
}
