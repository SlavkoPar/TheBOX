import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { errorMessage, filesApi, storageApi } from '../api'
import type { FileApp, FileItem, Folder, Found, Listing, StorageInfo } from '../api'
import { Lightbox, MoveDialog, PreviewDialog, SharedLinksDialog } from './FileDialogs'
import { ConfirmDialog, FormModal, PromptDialog } from './Modal'
import ShareDialog from './ShareDialog'
import ViewToggle from './ViewToggle'
import { RichTextEditor, SheetEditor, TextEditor } from './editors'
import { formatBytes, formatDate, saveBlob } from './format'
import { Icon } from './icons'
import { useAction } from './useAction'
import { useViewMode } from './useViewMode'

/**
 * Folder browser shared by Drive and Photos: subfolders, upload, selection,
 * sharing by email, move, rename, search and trash. The differences between
 * the two apps are the options below.
 */
export type FileBrowserOptions = {
  app: FileApp
  title: string
  /** "document" / "photo" — used in button labels and messages */
  noun: string
  folderNoun: string
  /** the view shown until the user picks List or Grid themselves */
  view: 'list' | 'grid'
  /** value for the file input's accept attribute */
  accept?: string
  /** offer Encrypt / Decrypt (Drive) */
  encryption: boolean
  /** offer new documents, the editors and Office previews (Drive) */
  documents: boolean
}

const DOCUMENT_KINDS = [
  { id: 'text', label: 'Text document', extension: '.txt', type: 'text/plain', content: '' },
  { id: 'rich', label: 'Formatted document', extension: '.html', type: 'text/html', content: '<p></p>' },
  { id: 'sheet', label: 'Spreadsheet', extension: '.csv', type: 'text/csv', content: '' },
] as const

const PLAIN_TEXT = ['text/plain', 'text/markdown']
const OFFICE = /\.(docx|xlsx|pptx)$/i

type Dialog =
  | { kind: 'new-folder' }
  | { kind: 'new-document' }
  | { kind: 'rename-folder'; folder: Folder }
  | { kind: 'rename-file'; file: FileItem }
  | { kind: 'trash'; files: FileItem[]; folders: Folder[] }
  | { kind: 'delete-forever'; files: FileItem[]; folders: Folder[] }
  | { kind: 'empty-trash' }
  | { kind: 'move'; files: FileItem[]; folders: Folder[] }
  | { kind: 'encrypt'; file: FileItem }
  | { kind: 'decrypt'; file: FileItem }
  | { kind: 'unlock'; file: FileItem }
  | { kind: 'share'; files: FileItem[]; folders: Folder[] }
  | { kind: 'links' }
  | { kind: 'edit'; editor: 'text' | 'rich' | 'sheet'; file: FileItem; content: string }
  | { kind: 'preview'; file: FileItem }
  | { kind: 'photo'; index: number }

type Data =
  | { view: 'browse'; listing: Listing }
  | { view: 'search'; found: Found }
  | { view: 'trash'; found: Found }

function describe(files: FileItem[], folders: Folder[], noun: string, folderNoun: string): string {
  if (files.length + folders.length === 1) return `“${(files[0] ?? folders[0]).name}”`
  const parts = [
    folders.length > 0 && `${folders.length} ${folderNoun}${folders.length === 1 ? '' : 's'}`,
    files.length > 0 && `${files.length} ${noun}${files.length === 1 ? '' : 's'}`,
  ].filter(Boolean)
  return parts.join(' and ')
}

function StorageMeter({ info }: { info: StorageInfo | null }) {
  if (!info) return null
  const text = info.quota
    ? `${formatBytes(info.used)} of ${formatBytes(info.quota)} used`
    : `${formatBytes(info.used)} used`
  return (
    <div className="storage">
      {info.quota > 0 && <progress value={Math.min(info.used, info.quota)} max={info.quota} aria-label="Storage used" />}
      <span className="hint">{text}</span>
    </div>
  )
}

export default function FileBrowser({ options }: { options: FileBrowserOptions }) {
  const { app, noun, folderNoun } = options
  const api = useMemo(() => filesApi(app), [app])
  const navigate = useNavigate()

  const [params] = useSearchParams()
  const folderId = Number(params.get('folder')) || null
  const query = (params.get('q') ?? '').trim()
  const view: Data['view'] = params.get('view') === 'trash' ? 'trash' : query ? 'search' : 'browse'

  const [data, setData] = useState<Data | null>(null)
  const [loadError, setLoadError] = useState('')
  const [storage, setStorage] = useState<StorageInfo | null>(null)
  const [selFiles, setSelFiles] = useState<Set<number>>(new Set())
  const [selFolders, setSelFolders] = useState<Set<number>>(new Set())
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [searchText, setSearchText] = useState(query)
  const action = useAction()
  const [mode, setMode] = useViewMode(app, options.view)
  const fileInput = useRef<HTMLInputElement>(null)

  const fetchData = useCallback(async (): Promise<Data> => {
    if (view === 'trash') return { view, found: await api.trash() }
    if (view === 'search') return { view, found: await api.search(query) }
    return { view, listing: await api.list(folderId) }
  }, [api, view, query, folderId])

  const loadStorage = useCallback(() => {
    // The meter is a nicety: if it cannot be loaded, the page works without it.
    storageApi.get().then(setStorage, () => undefined)
  }, [])

  const reload = useCallback(async () => {
    try {
      setData(await fetchData())
      setLoadError('')
    } catch (err) {
      setLoadError(errorMessage(err))
    }
    loadStorage()
  }, [fetchData, loadStorage])

  useEffect(() => {
    let cancelled = false
    fetchData()
      .then((loaded) => {
        if (cancelled) return
        setData(loaded)
        setLoadError('')
        setSelFiles(new Set())
        setSelFolders(new Set())
      })
      .catch((err) => {
        if (!cancelled) setLoadError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [fetchData])

  useEffect(loadStorage, [loadStorage])

  // Keep the search box in step with the URL (back button, leaving the results).
  const [shownQuery, setShownQuery] = useState(query)
  if (shownQuery !== query) {
    setShownQuery(query)
    setSearchText(query)
  }

  const current = data?.view === view ? data : null
  const files = current ? (current.view === 'browse' ? current.listing.files : current.found.files) : []
  const folders = current ? (current.view === 'browse' ? current.listing.folders : current.found.folders) : []
  const listing = current?.view === 'browse' ? current.listing : null
  const browsing = view === 'browse'
  // The trash is always a table: what matters there is where things were and when they went.
  const grid = view !== 'trash' && mode === 'grid'
  /** Photos open in the viewer with the slideshow; documents in an editor, preview or new tab. */
  const gallery = !options.documents
  const hasThumb = (file: FileItem) => file.mime_type.startsWith('image/') && !file.is_encrypted

  const pickedFiles = files.filter((file) => selFiles.has(file.id))
  const pickedFolders = folders.filter((folder) => selFolders.has(folder.id))
  const picked = pickedFiles.length + pickedFolders.length
  const total = files.length + folders.length
  const allSelected = total > 0 && picked === total
  const close = () => setDialog(null)
  const folderLink = (id: number | null) => (id ? `/${app}?folder=${id}` : `/${app}`)

  function toggle(set: Set<number>, update: (next: Set<number>) => void, id: number) {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    update(next)
  }

  function selectAll() {
    setSelFiles(allSelected ? new Set() : new Set(files.map((f) => f.id)))
    setSelFolders(allSelected ? new Set() : new Set(folders.map((f) => f.id)))
  }

  function clearSelection() {
    setSelFiles(new Set())
    setSelFolders(new Set())
  }

  function search(event: FormEvent) {
    event.preventDefault()
    const text = searchText.trim()
    navigate(text ? `/${app}?q=${encodeURIComponent(text)}` : `/${app}`)
  }

  async function onUpload(event: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? [])
    event.target.value = '' // let the same file be chosen again
    if (chosen.length === 0) return
    await action.run(async () => {
      await api.upload(chosen, folderId)
      await reload()
    })
  }

  /** Open a file with whatever fits its type. */
  async function open(file: FileItem) {
    if (file.is_encrypted) return setDialog({ kind: 'unlock', file })
    if (gallery) {
      return setDialog({ kind: 'photo', index: Math.max(0, files.findIndex((f) => f.id === file.id)) })
    }
    const editor =
      !options.documents ? null
      : PLAIN_TEXT.includes(file.mime_type) ? 'text'
      : file.mime_type === 'text/html' ? 'rich'
      : file.mime_type === 'text/csv' ? 'sheet'
      : null
    if (editor) {
      await action.run(async () => {
        const content = await (await api.content(file.id)).text()
        setDialog({ kind: 'edit', editor, file, content })
      })
    } else if (options.documents && OFFICE.test(file.name)) {
      setDialog({ kind: 'preview', file })
    } else {
      window.open(api.contentUrl(file.id), '_blank', 'noopener')
    }
  }

  function iconButton(label: string, icon: Parameters<typeof Icon>[0]['name'], onClick: () => void, title = label) {
    return (
      <button type="button" className="icon-button" aria-label={label} title={title} onClick={onClick}>
        <Icon name={icon} />
      </button>
    )
  }

  function fileActions(file: FileItem) {
    return (
      <>
        {file.is_encrypted ? (
          iconButton(`Download ${file.name}`, 'download', () => setDialog({ kind: 'unlock', file }), 'Download (needs the password)')
        ) : (
          <a className="icon-button" href={api.contentUrl(file.id, true)} aria-label={`Download ${file.name}`} title="Download">
            <Icon name="download" />
          </a>
        )}
        {options.encryption &&
          iconButton(
            `${file.is_encrypted ? 'Decrypt' : 'Encrypt'} ${file.name}`,
            file.is_encrypted ? 'unlock' : 'lock',
            () => setDialog({ kind: file.is_encrypted ? 'decrypt' : 'encrypt', file }),
            file.is_encrypted ? 'Decrypt' : 'Encrypt',
          )}
        {iconButton(`Move ${file.name}`, 'move', () => setDialog({ kind: 'move', files: [file], folders: [] }), 'Move')}
        {iconButton(`Rename ${file.name}`, 'edit', () => setDialog({ kind: 'rename-file', file }), 'Rename')}
        {iconButton(`Delete ${file.name}`, 'trash', () => setDialog({ kind: 'trash', files: [file], folders: [] }), 'Move to trash')}
      </>
    )
  }

  function folderActions(folder: Folder) {
    const name = `${folderNoun} ${folder.name}`
    return (
      <>
        {iconButton(`Move ${name}`, 'move', () => setDialog({ kind: 'move', files: [], folders: [folder] }), 'Move')}
        {iconButton(`Rename ${name}`, 'edit', () => setDialog({ kind: 'rename-folder', folder }), 'Rename')}
        {iconButton(`Delete ${name}`, 'trash', () => setDialog({ kind: 'trash', files: [], folders: [folder] }), 'Move to trash')}
      </>
    )
  }

  function trashActions(files: FileItem[], folders: Folder[], name: string) {
    return (
      <>
        <button
          type="button"
          className="secondary"
          aria-label={`Restore ${name}`}
          onClick={() =>
            action.run(async () => {
              await api.restore(files.map((f) => f.id), folders.map((f) => f.id))
              await reload()
            })
          }
        >
          Restore
        </button>
        <button
          type="button"
          className="secondary"
          aria-label={`Delete ${name} forever`}
          onClick={() => setDialog({ kind: 'delete-forever', files, folders })}
        >
          Delete forever
        </button>
      </>
    )
  }

  const empty = current !== null && total === 0

  return (
    <div className="page">
      <div className="page-header">
        <nav className="breadcrumbs" aria-label="Folder path">
          {browsing && !folderId ? <h2>{options.title}</h2> : <Link to={folderLink(null)}>{options.title}</Link>}
          {view === 'trash' && (
            <span className="crumb">
              <Icon name="right" size={14} />
              <h2>Trash</h2>
            </span>
          )}
          {view === 'search' && (
            <span className="crumb">
              <Icon name="right" size={14} />
              <h2>Results for “{query}”</h2>
            </span>
          )}
          {listing?.breadcrumbs.map((crumb, index) => {
            const last = index === listing.breadcrumbs.length - 1
            return (
              <span key={crumb.id} className="crumb">
                <Icon name="right" size={14} />
                {last ? <h2>{crumb.name}</h2> : <Link to={folderLink(crumb.id)}>{crumb.name}</Link>}
              </span>
            )
          })}
        </nav>

        <form className="search" role="search" onSubmit={search}>
          <input
            type="search"
            aria-label={`Search ${options.title}`}
            placeholder={`Search ${options.title}`}
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
          <button type="submit" className="icon-button" aria-label="Search">
            <Icon name="search" />
          </button>
        </form>
      </div>

      <div className="toolbar">
        {browsing && (
          <>
            <button type="button" onClick={() => fileInput.current?.click()} disabled={action.busy}>
              <Icon name="upload" size={18} /> Upload
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              accept={options.accept}
              aria-label={`Upload ${noun}s`}
              onChange={onUpload}
            />
            <button type="button" className="secondary" onClick={() => setDialog({ kind: 'new-folder' })}>
              <Icon name="folder" size={18} /> New {folderNoun}
            </button>
            {options.documents && (
              <button type="button" className="secondary" onClick={() => setDialog({ kind: 'new-document' })}>
                <Icon name="file" size={18} /> New document
              </button>
            )}
          </>
        )}
        {view === 'trash' && (
          <button type="button" className="secondary" disabled={total === 0} onClick={() => setDialog({ kind: 'empty-trash' })}>
            <Icon name="trash" size={18} /> Empty trash
          </button>
        )}
        <span className="spacer" />
        {view !== 'trash' && <ViewToggle mode={mode} onChange={setMode} />}
        <StorageMeter info={storage} />
        <button type="button" className="secondary" onClick={() => setDialog({ kind: 'links' })}>
          <Icon name="send" size={18} /> Shared links
        </button>
        {view !== 'trash' && (
          <Link className="button secondary" to={`/${app}?view=trash`}>
            <Icon name="trash" size={18} /> Trash
          </Link>
        )}
      </div>

      {(loadError || action.error) && (
        <p className="error" role="alert">
          {loadError || action.error}
        </p>
      )}

      {browsing && total > 0 && (
        <div className="selection-bar">
          <label className="check">
            <input type="checkbox" checked={allSelected} onChange={selectAll} />
            Select all
          </label>
          <span className="hint" aria-live="polite">
            {picked > 0 ? `${picked} selected` : `Select ${noun}s or ${folderNoun}s to share, move or delete them`}
          </span>
          <span className="spacer" />
          <button type="button" disabled={picked === 0} onClick={() => setDialog({ kind: 'share', files: pickedFiles, folders: pickedFolders })}>
            <Icon name="send" size={18} /> Share
          </button>
          <button type="button" className="secondary" disabled={picked === 0} onClick={() => setDialog({ kind: 'move', files: pickedFiles, folders: pickedFolders })}>
            <Icon name="move" size={18} /> Move
          </button>
          <button type="button" className="secondary" disabled={picked === 0} onClick={() => setDialog({ kind: 'trash', files: pickedFiles, folders: pickedFolders })}>
            <Icon name="trash" size={18} /> Delete
          </button>
        </div>
      )}

      {current === null && !loadError && <p>Loading…</p>}

      {empty && browsing && (
        <p className="empty">
          This {folderId ? folderNoun : 'space'} is empty. Upload {noun}s or create a {folderNoun}.
        </p>
      )}
      {empty && view === 'search' && <p className="empty">Nothing found for “{query}”.</p>}
      {empty && view === 'trash' && <p className="empty">The trash is empty.</p>}

      {view === 'trash' && !empty && current && (
        <>
          <p className="hint">
            Items in the trash still use storage. Restore them, or delete them forever to free the space.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Was in</th>
                  <th>Deleted</th>
                  <th>
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {folders.map((folder) => (
                  <tr key={`folder-${folder.id}`}>
                    <td>
                      <span className="item-name">
                        <Icon name="folder" /> {folder.name}
                      </span>
                    </td>
                    <td>{folder.path || options.title}</td>
                    <td>{folder.deleted_at && formatDate(folder.deleted_at)}</td>
                    <td className="row-actions">{trashActions([], [folder], folder.name)}</td>
                  </tr>
                ))}
                {files.map((file) => (
                  <tr key={file.id}>
                    <td>
                      <span className="item-name">
                        <Icon name={file.is_encrypted ? 'lock' : 'file'} /> {file.name}
                      </span>
                    </td>
                    <td>{file.path || options.title}</td>
                    <td>{file.deleted_at && formatDate(file.deleted_at)}</td>
                    <td className="row-actions">{trashActions([file], [], file.name)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view !== 'trash' && !grid && !empty && current && (
        <div className="table-wrap">
          <table className="table file-table">
            <thead>
              <tr>
                {browsing && (
                  <th className="col-check">
                    <span className="visually-hidden">Select</span>
                  </th>
                )}
                <th>Name</th>
                {view === 'search' && <th>In</th>}
                <th>Size</th>
                <th>Modified</th>
                <th>
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {folders.map((folder) => (
                <tr key={`folder-${folder.id}`} className={selFolders.has(folder.id) ? 'selected' : undefined}>
                  {browsing && (
                    <td className="col-check">
                      <input
                        type="checkbox"
                        checked={selFolders.has(folder.id)}
                        aria-label={`Select ${folderNoun} ${folder.name}`}
                        onChange={() => toggle(selFolders, setSelFolders, folder.id)}
                      />
                    </td>
                  )}
                  <td>
                    <Link to={folderLink(folder.id)} className="item-name">
                      <Icon name="folder" /> {folder.name}
                    </Link>
                  </td>
                  {view === 'search' && <td>{folder.path || options.title}</td>}
                  <td>—</td>
                  <td>{formatDate(folder.created_at)}</td>
                  <td className="row-actions">{folderActions(folder)}</td>
                </tr>
              ))}
              {files.map((file) => (
                <tr key={file.id} className={selFiles.has(file.id) ? 'selected' : undefined}>
                  {browsing && (
                    <td className="col-check">
                      <input
                        type="checkbox"
                        checked={selFiles.has(file.id)}
                        aria-label={`Select ${file.name}`}
                        onChange={() => toggle(selFiles, setSelFiles, file.id)}
                      />
                    </td>
                  )}
                  <td>
                    <button type="button" className="item-name link-button" onClick={() => open(file)}>
                      {gallery && hasThumb(file) ? (
                        <img className="thumb-small" src={api.thumbUrl(file.id)} alt="" loading="lazy" />
                      ) : (
                        <Icon name={file.is_encrypted ? 'lock' : 'file'} />
                      )}{' '}
                      {file.name}
                    </button>
                    {file.is_encrypted && <span className="badge">Encrypted</span>}
                  </td>
                  {view === 'search' && (
                    <td>
                      <Link to={folderLink(file.folder_id)}>{file.path || options.title}</Link>
                    </td>
                  )}
                  <td>{formatBytes(file.size)}</td>
                  <td>{formatDate(file.updated_at)}</td>
                  <td className="row-actions">{fileActions(file)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {grid && !empty && current && (
        <>
          {folders.length > 0 && (
            <ul className="folder-tiles" aria-label={`${folderNoun}s`}>
              {folders.map((folder) => (
                <li key={folder.id} className={selFolders.has(folder.id) ? 'folder-tile selected' : 'folder-tile'}>
                  {browsing && (
                    <input
                      type="checkbox"
                      checked={selFolders.has(folder.id)}
                      aria-label={`Select ${folderNoun} ${folder.name}`}
                      onChange={() => toggle(selFolders, setSelFolders, folder.id)}
                    />
                  )}
                  <Link
                    to={folderLink(folder.id)}
                    className="item-name"
                    title={view === 'search' ? `In ${folder.path || options.title}` : undefined}
                  >
                    <Icon name="folder" /> {folder.name}
                  </Link>
                  <span className="spacer" />
                  <span className="row-actions">{folderActions(folder)}</span>
                </li>
              ))}
            </ul>
          )}
          {files.length > 0 && (
            <ul className="photo-grid" aria-label={`${noun}s`}>
              {files.map((file) => (
                <li key={file.id} className={selFiles.has(file.id) ? 'photo selected' : 'photo'}>
                  {hasThumb(file) ? (
                    <button type="button" className="photo-open" onClick={() => open(file)}>
                      <img src={api.thumbUrl(file.id)} alt={file.name} loading="lazy" />
                    </button>
                  ) : (
                    <button type="button" className="photo-open file-tile" onClick={() => open(file)}>
                      <Icon name={file.is_encrypted ? 'lock' : 'file'} size={48} />
                      <span className="visually-hidden">{file.name}</span>
                    </button>
                  )}
                  {browsing && (
                    <input
                      type="checkbox"
                      className="photo-check"
                      checked={selFiles.has(file.id)}
                      aria-label={`Select ${file.name}`}
                      onChange={() => toggle(selFiles, setSelFiles, file.id)}
                    />
                  )}
                  <div className="photo-caption">
                    <span title={file.name}>{file.name}</span>
                    <span className="row-actions">{fileActions(file)}</span>
                  </div>
                  {view === 'search' && (
                    <Link className="photo-path" to={folderLink(file.folder_id)}>
                      In {file.path || options.title}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* --- Dialogs --- */}

      {dialog?.kind === 'new-folder' && (
        <PromptDialog
          title={`New ${folderNoun}`}
          label="Name"
          submitLabel="Create"
          onClose={close}
          onSubmit={async (name) => {
            await api.createFolder(name, folderId)
            await reload()
          }}
        />
      )}

      {dialog?.kind === 'new-document' && (
        <NewDocumentDialog
          onClose={close}
          onCreate={async (file) => {
            await api.upload([file], folderId)
            await reload()
          }}
        />
      )}

      {dialog?.kind === 'rename-folder' && (
        <PromptDialog
          title={`Rename ${folderNoun}`}
          label="Name"
          submitLabel="Rename"
          initial={dialog.folder.name}
          onClose={close}
          onSubmit={async (name) => {
            await api.renameFolder(dialog.folder.id, name)
            await reload()
          }}
        />
      )}

      {dialog?.kind === 'rename-file' && (
        <PromptDialog
          title={`Rename ${noun}`}
          label="Name"
          submitLabel="Rename"
          initial={dialog.file.name}
          onClose={close}
          onSubmit={async (name) => {
            await api.renameFile(dialog.file.id, name)
            await reload()
          }}
        />
      )}

      {dialog?.kind === 'trash' && (
        <ConfirmDialog
          title="Move to trash"
          message={
            <>
              Move {describe(dialog.files, dialog.folders, noun, folderNoun)} to the trash?
              {dialog.folders.length > 0 && ` Everything inside goes with it.`} You can restore it from
              the trash later.
            </>
          }
          confirmLabel="Move to trash"
          onClose={close}
          onConfirm={async () => {
            try {
              for (const folder of dialog.folders) await api.deleteFolder(folder.id)
              for (const file of dialog.files) await api.deleteFile(file.id)
            } finally {
              clearSelection()
              await reload()
            }
          }}
        />
      )}

      {dialog?.kind === 'delete-forever' && (
        <ConfirmDialog
          title="Delete forever"
          message={`Delete ${describe(dialog.files, dialog.folders, noun, folderNoun)} forever? This cannot be undone.`}
          confirmLabel="Delete forever"
          onClose={close}
          onConfirm={async () => {
            try {
              for (const folder of dialog.folders) await api.deleteFolder(folder.id, true)
              for (const file of dialog.files) await api.deleteFile(file.id, true)
            } finally {
              await reload()
            }
          }}
        />
      )}

      {dialog?.kind === 'empty-trash' && (
        <ConfirmDialog
          title="Empty trash"
          message="Delete everything in the trash forever? This cannot be undone."
          confirmLabel="Empty trash"
          onClose={close}
          onConfirm={async () => {
            await api.emptyTrash()
            await reload()
          }}
        />
      )}

      {dialog?.kind === 'move' && (
        <MoveDialog
          api={api}
          files={dialog.files}
          folders={dialog.folders}
          rootName={options.title}
          onClose={close}
          onMoved={async () => {
            clearSelection()
            await reload()
          }}
        />
      )}

      {dialog?.kind === 'encrypt' && (
        <PromptDialog
          title={`Encrypt ${dialog.file.name}`}
          label="Password"
          type="password"
          minLength={8}
          submitLabel="Encrypt"
          hint="The document can only be opened with this password. It is not stored anywhere: if you forget it, the document cannot be recovered."
          onClose={close}
          onSubmit={async (password) => {
            await api.encrypt(dialog.file.id, password)
            await reload()
          }}
        />
      )}

      {dialog?.kind === 'decrypt' && (
        <PromptDialog
          title={`Decrypt ${dialog.file.name}`}
          label="Password"
          type="password"
          submitLabel="Decrypt"
          hint="Removes the encryption. The document will be stored unencrypted again."
          onClose={close}
          onSubmit={async (password) => {
            await api.decrypt(dialog.file.id, password)
            await reload()
          }}
        />
      )}

      {dialog?.kind === 'unlock' && (
        <PromptDialog
          title={`Download ${dialog.file.name}`}
          label="Password"
          type="password"
          submitLabel="Download"
          hint="This document is encrypted. Enter its password to download a decrypted copy."
          onClose={close}
          onSubmit={async (password) => {
            saveBlob(await api.content(dialog.file.id, password), dialog.file.name)
          }}
        />
      )}

      {dialog?.kind === 'share' && (
        <ShareDialog
          files={dialog.files}
          folders={dialog.folders}
          noun={noun}
          folderNoun={folderNoun}
          onClose={close}
        />
      )}

      {dialog?.kind === 'links' && <SharedLinksDialog api={api} noun={noun} onClose={close} />}

      {dialog?.kind === 'edit' &&
        (() => {
          const Editor = { text: TextEditor, rich: RichTextEditor, sheet: SheetEditor }[dialog.editor]
          return (
            <Editor
              file={dialog.file}
              initial={dialog.content}
              onClose={close}
              onSave={async (content) => {
                await api.saveText(dialog.file.id, content)
                await reload()
              }}
            />
          )
        })()}

      {dialog?.kind === 'preview' && <PreviewDialog api={api} file={dialog.file} onClose={close} />}

      {dialog?.kind === 'photo' && files[dialog.index] && (
        <Lightbox
          api={api}
          files={files}
          index={dialog.index}
          onIndex={(index) => setDialog({ kind: 'photo', index })}
          onClose={close}
        />
      )}
    </div>
  )
}

type NewDocumentProps = {
  onClose: () => void
  onCreate: (file: File) => Promise<unknown>
}

function NewDocumentDialog({ onClose, onCreate }: NewDocumentProps) {
  const [name, setName] = useState('Untitled')
  const [kindId, setKindId] = useState<(typeof DOCUMENT_KINDS)[number]['id']>('text')

  function create() {
    const kind = DOCUMENT_KINDS.find((k) => k.id === kindId)!
    const base = name.trim().replace(/\.(txt|html?|csv)$/i, '')
    if (!base) return Promise.reject(new Error('Enter a name.'))
    return onCreate(new File([kind.content], `${base}${kind.extension}`, { type: kind.type }))
  }

  return (
    <FormModal title="New document" submitLabel="Create" onClose={onClose} onSubmit={create}>
      <label>
        Name
        <input value={name} required autoFocus onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        Type
        <select value={kindId} onChange={(event) => setKindId(event.target.value as typeof kindId)}>
          {DOCUMENT_KINDS.map((kind) => (
            <option key={kind.id} value={kind.id}>
              {kind.label} ({kind.extension})
            </option>
          ))}
        </select>
      </label>
    </FormModal>
  )
}
