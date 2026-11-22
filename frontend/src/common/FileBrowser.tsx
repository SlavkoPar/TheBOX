import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { errorMessage, filesApi } from '../api'
import type { FileApp, FileItem, Folder, Listing } from '../api'
import { ConfirmDialog, FormModal, Modal, PromptDialog } from './Modal'
import ShareDialog from './ShareDialog'
import { formatBytes, formatDate, saveBlob } from './format'
import { Icon } from './icons'
import { useAction } from './useAction'

/**
 * Folder browser shared by Drive and Photos: subfolders, upload, selection,
 * sharing by email, rename and delete. The differences between the two apps
 * are the options below.
 */
export type FileBrowserOptions = {
  app: FileApp
  title: string
  /** "document" / "photo" — used in button labels and messages */
  noun: string
  folderNoun: string
  view: 'list' | 'grid'
  /** value for the file input's accept attribute */
  accept?: string
  /** offer Encrypt / Decrypt (Drive) */
  encryption: boolean
  /** offer "New document" and the text editor (Drive) */
  textDocuments: boolean
}

const TEXT_TYPES = ['text/plain', 'text/markdown', 'text/csv']

type Dialog =
  | { kind: 'new-folder' }
  | { kind: 'new-document' }
  | { kind: 'rename-folder'; folder: Folder }
  | { kind: 'rename-file'; file: FileItem }
  | { kind: 'delete-folder'; folder: Folder }
  | { kind: 'delete-files'; files: FileItem[] }
  | { kind: 'encrypt'; file: FileItem }
  | { kind: 'decrypt'; file: FileItem }
  | { kind: 'unlock'; file: FileItem }
  | { kind: 'share'; files: FileItem[] }
  | { kind: 'edit'; file: FileItem; content: string }
  | { kind: 'photo'; file: FileItem }

export default function FileBrowser({ options }: { options: FileBrowserOptions }) {
  const { app, noun, view } = options
  const api = useMemo(() => filesApi(app), [app])

  const [params] = useSearchParams()
  const folderId = Number(params.get('folder')) || null

  const [listing, setListing] = useState<Listing | null>(null)
  const [loadError, setLoadError] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const action = useAction()
  const fileInput = useRef<HTMLInputElement>(null)

  const reload = useCallback(async () => {
    try {
      setListing(await api.list(folderId))
      setLoadError('')
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }, [api, folderId])

  useEffect(() => {
    let cancelled = false
    api
      .list(folderId)
      .then((loaded) => {
        if (cancelled) return
        setListing(loaded)
        setLoadError('')
        setSelected(new Set())
      })
      .catch((err) => {
        if (!cancelled) setLoadError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [api, folderId])

  const files = listing?.files ?? []
  const folders = listing?.folders ?? []
  const selectedFiles = files.filter((file) => selected.has(file.id))
  const allSelected = files.length > 0 && selectedFiles.length === files.length
  const close = () => setDialog(null)
  const folderLink = (id: number | null) => (id ? `/${app}?folder=${id}` : `/${app}`)

  function toggle(id: number) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
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

  /** Open a file: editor for text, lightbox for photos, a new tab otherwise. */
  async function open(file: FileItem) {
    if (file.is_encrypted) {
      setDialog({ kind: 'unlock', file })
    } else if (view === 'grid') {
      setDialog({ kind: 'photo', file })
    } else if (options.textDocuments && TEXT_TYPES.includes(file.mime_type)) {
      await action.run(async () => {
        const content = await (await api.content(file.id)).text()
        setDialog({ kind: 'edit', file, content })
      })
    } else {
      window.open(api.contentUrl(file.id), '_blank', 'noopener')
    }
  }

  function fileActions(file: FileItem) {
    return (
      <>
        {file.is_encrypted ? (
          <button
            type="button"
            className="icon-button"
            aria-label={`Download ${file.name}`}
            title="Download (needs the password)"
            onClick={() => setDialog({ kind: 'unlock', file })}
          >
            <Icon name="download" />
          </button>
        ) : (
          <a
            className="icon-button"
            href={api.contentUrl(file.id, true)}
            aria-label={`Download ${file.name}`}
            title="Download"
          >
            <Icon name="download" />
          </a>
        )}
        {options.encryption && (
          <button
            type="button"
            className="icon-button"
            aria-label={`${file.is_encrypted ? 'Decrypt' : 'Encrypt'} ${file.name}`}
            title={file.is_encrypted ? 'Decrypt' : 'Encrypt'}
            onClick={() => setDialog({ kind: file.is_encrypted ? 'decrypt' : 'encrypt', file })}
          >
            <Icon name={file.is_encrypted ? 'unlock' : 'lock'} />
          </button>
        )}
        <button
          type="button"
          className="icon-button"
          aria-label={`Rename ${file.name}`}
          title="Rename"
          onClick={() => setDialog({ kind: 'rename-file', file })}
        >
          <Icon name="edit" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`Delete ${file.name}`}
          title="Delete"
          onClick={() => setDialog({ kind: 'delete-files', files: [file] })}
        >
          <Icon name="trash" />
        </button>
      </>
    )
  }

  function folderActions(folder: Folder) {
    return (
      <>
        <button
          type="button"
          className="icon-button"
          aria-label={`Rename ${options.folderNoun} ${folder.name}`}
          title="Rename"
          onClick={() => setDialog({ kind: 'rename-folder', folder })}
        >
          <Icon name="edit" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`Delete ${options.folderNoun} ${folder.name}`}
          title="Delete"
          onClick={() => setDialog({ kind: 'delete-folder', folder })}
        >
          <Icon name="trash" />
        </button>
      </>
    )
  }

  const empty = listing !== null && folders.length === 0 && files.length === 0

  return (
    <div className="page">
      <div className="page-header">
        <nav className="breadcrumbs" aria-label="Folder path">
          {folderId ? <Link to={folderLink(null)}>{options.title}</Link> : <h2>{options.title}</h2>}
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

        <div className="toolbar">
          <button type="button" className="secondary" onClick={() => setDialog({ kind: 'new-folder' })}>
            <Icon name="folder" size={18} /> New {options.folderNoun}
          </button>
          {options.textDocuments && (
            <button type="button" className="secondary" onClick={() => setDialog({ kind: 'new-document' })}>
              <Icon name="file" size={18} /> New document
            </button>
          )}
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
        </div>
      </div>

      {(loadError || action.error) && (
        <p className="error" role="alert">
          {loadError || action.error}
        </p>
      )}

      {files.length > 0 && (
        <div className="selection-bar">
          <label className="check">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(files.map((f) => f.id)))}
            />
            Select all
          </label>
          <span className="hint" aria-live="polite">
            {selectedFiles.length > 0 ? `${selectedFiles.length} selected` : `Select ${noun}s to share them`}
          </span>
          <span className="spacer" />
          <button
            type="button"
            disabled={selectedFiles.length === 0}
            onClick={() => setDialog({ kind: 'share', files: selectedFiles })}
          >
            <Icon name="send" size={18} /> Share
          </button>
          <button
            type="button"
            className="secondary"
            disabled={selectedFiles.length === 0}
            onClick={() => setDialog({ kind: 'delete-files', files: selectedFiles })}
          >
            <Icon name="trash" size={18} /> Delete
          </button>
        </div>
      )}

      {listing === null && !loadError && <p>Loading…</p>}

      {empty && (
        <p className="empty">
          This {folderId ? options.folderNoun : 'space'} is empty. Upload {noun}s or create a{' '}
          {options.folderNoun}.
        </p>
      )}

      {view === 'list' && !empty && listing && (
        <div className="table-wrap">
          <table className="table file-table">
            <thead>
              <tr>
                <th className="col-check">
                  <span className="visually-hidden">Select</span>
                </th>
                <th>Name</th>
                <th>Size</th>
                <th>Modified</th>
                <th>
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {folders.map((folder) => (
                <tr key={`folder-${folder.id}`}>
                  <td className="col-check" />
                  <td>
                    <Link to={folderLink(folder.id)} className="item-name">
                      <Icon name="folder" /> {folder.name}
                    </Link>
                  </td>
                  <td>—</td>
                  <td>{formatDate(folder.created_at)}</td>
                  <td className="row-actions">{folderActions(folder)}</td>
                </tr>
              ))}
              {files.map((file) => (
                <tr key={file.id} className={selected.has(file.id) ? 'selected' : undefined}>
                  <td className="col-check">
                    <input
                      type="checkbox"
                      checked={selected.has(file.id)}
                      aria-label={`Select ${file.name}`}
                      onChange={() => toggle(file.id)}
                    />
                  </td>
                  <td>
                    <button type="button" className="item-name link-button" onClick={() => open(file)}>
                      <Icon name={file.is_encrypted ? 'lock' : 'file'} /> {file.name}
                    </button>
                    {file.is_encrypted && <span className="badge">Encrypted</span>}
                  </td>
                  <td>{formatBytes(file.size)}</td>
                  <td>{formatDate(file.updated_at)}</td>
                  <td className="row-actions">{fileActions(file)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'grid' && !empty && listing && (
        <>
          {folders.length > 0 && (
            <ul className="folder-tiles" aria-label={`${options.folderNoun}s`}>
              {folders.map((folder) => (
                <li key={folder.id} className="folder-tile">
                  <Link to={folderLink(folder.id)} className="item-name">
                    <Icon name="folder" /> {folder.name}
                  </Link>
                  <span className="row-actions">{folderActions(folder)}</span>
                </li>
              ))}
            </ul>
          )}
          <ul className="photo-grid" aria-label={`${noun}s`}>
            {files.map((file) => (
              <li key={file.id} className={selected.has(file.id) ? 'photo selected' : 'photo'}>
                <button type="button" className="photo-open" onClick={() => open(file)}>
                  <img src={api.contentUrl(file.id)} alt={file.name} loading="lazy" />
                </button>
                <input
                  type="checkbox"
                  className="photo-check"
                  checked={selected.has(file.id)}
                  aria-label={`Select ${file.name}`}
                  onChange={() => toggle(file.id)}
                />
                <div className="photo-caption">
                  <span title={file.name}>{file.name}</span>
                  <span className="row-actions">{fileActions(file)}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* --- Dialogs --- */}

      {dialog?.kind === 'new-folder' && (
        <PromptDialog
          title={`New ${options.folderNoun}`}
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
        <PromptDialog
          title="New document"
          label="Name"
          submitLabel="Create"
          initial="Untitled.txt"
          hint="A text document you can edit here."
          onClose={close}
          onSubmit={async (name) => {
            const fileName = /\.[a-z0-9]+$/i.test(name.trim()) ? name.trim() : `${name.trim()}.txt`
            await api.upload([new File([''], fileName, { type: 'text/plain' })], folderId)
            await reload()
          }}
        />
      )}

      {dialog?.kind === 'rename-folder' && (
        <PromptDialog
          title={`Rename ${options.folderNoun}`}
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

      {dialog?.kind === 'delete-folder' && (
        <ConfirmDialog
          title={`Delete ${options.folderNoun}`}
          message={`Delete “${dialog.folder.name}” and everything inside it? This cannot be undone.`}
          confirmLabel="Delete"
          onClose={close}
          onConfirm={async () => {
            await api.deleteFolder(dialog.folder.id)
            await reload()
          }}
        />
      )}

      {dialog?.kind === 'delete-files' && (
        <ConfirmDialog
          title={dialog.files.length === 1 ? `Delete ${noun}` : `Delete ${dialog.files.length} ${noun}s`}
          message={
            dialog.files.length === 1
              ? `Delete “${dialog.files[0].name}”? This cannot be undone.`
              : `Delete the ${dialog.files.length} selected ${noun}s? This cannot be undone.`
          }
          confirmLabel="Delete"
          onClose={close}
          onConfirm={async () => {
            try {
              for (const file of dialog.files) await api.deleteFile(file.id)
            } finally {
              setSelected(new Set())
              await reload()
            }
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
        <ShareDialog api={api} files={dialog.files} noun={noun} onClose={close} />
      )}

      {dialog?.kind === 'edit' && (
        <TextEditor
          file={dialog.file}
          initial={dialog.content}
          onClose={close}
          onSave={async (content) => {
            await api.saveText(dialog.file.id, content)
            await reload()
          }}
        />
      )}

      {dialog?.kind === 'photo' && (
        <Modal title={dialog.file.name} onClose={close} wide>
          <div className="lightbox">
            <img src={api.contentUrl(dialog.file.id)} alt={dialog.file.name} />
            <a className="button" href={api.contentUrl(dialog.file.id, true)}>
              <Icon name="download" size={18} /> Download
            </a>
          </div>
        </Modal>
      )}
    </div>
  )
}

type EditorProps = {
  file: FileItem
  initial: string
  onClose: () => void
  onSave: (content: string) => Promise<unknown>
}

function TextEditor({ file, initial, onClose, onSave }: EditorProps) {
  const [content, setContent] = useState(initial)
  return (
    <FormModal title={file.name} submitLabel="Save" onClose={onClose} onSubmit={() => onSave(content)} wide>
      <label>
        <span className="visually-hidden">Content</span>
        <textarea
          className="editor"
          rows={18}
          value={content}
          autoFocus
          onChange={(event) => setContent(event.target.value)}
        />
      </label>
    </FormModal>
  )
}
