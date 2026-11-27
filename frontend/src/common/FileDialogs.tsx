// Dialogs of the file browser: Office preview, move to folder, shared links, slideshow.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { errorMessage } from '../api'
import type { FileItem, FilesApi, Folder, Preview, SharedLink } from '../api'
import { FormModal, Modal } from './Modal'
import { formatBytes, formatDate } from './format'
import { Icon } from './icons'
import { useAction } from './useAction'

/** Loads something when the dialog opens. */
function useLoaded<T>(load: () => Promise<T>) {
  const [value, setValue] = useState<T | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    load()
      .then((loaded) => {
        if (!cancelled) setValue(loaded)
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [load])

  return { value, setValue, error }
}

// --- Preview of Word / Excel / PowerPoint files -----------------------------------------

function Grid({ rows }: { rows: string[][] }) {
  if (rows.length === 0) return <p className="hint">This sheet is empty.</p>
  return (
    <div className="table-wrap">
      <table className="table preview-table">
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PreviewBody({ preview }: { preview: Preview }) {
  if (preview.kind === 'document') {
    return (
      <>
        {preview.blocks.map((block, index) => {
          if (block.type === 'heading') {
            const Tag = block.level === 1 ? 'h3' : block.level === 2 ? 'h4' : 'h5'
            return <Tag key={index}>{block.text}</Tag>
          }
          if (block.type === 'table') return <Grid key={index} rows={block.rows} />
          if (block.type === 'list-item') {
            return (
              <p key={index} className="preview-list-item">
                • {block.text}
              </p>
            )
          }
          return <p key={index}>{block.text}</p>
        })}
      </>
    )
  }
  if (preview.kind === 'sheets') {
    return (
      <>
        {preview.sheets.map((sheet) => (
          <section key={sheet.name}>
            <h3>{sheet.name}</h3>
            <Grid rows={sheet.rows} />
          </section>
        ))}
      </>
    )
  }
  return (
    <ol className="preview-slides">
      {preview.slides.map((slide, index) => (
        <li key={index}>
          <h3>{slide.title || `Slide ${index + 1}`}</h3>
          {slide.lines.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </li>
      ))}
    </ol>
  )
}

export function PreviewDialog({ api, file, onClose }: { api: FilesApi; file: FileItem; onClose: () => void }) {
  const load = useCallback(() => api.preview(file.id), [api, file.id])
  const { value: preview, error } = useLoaded(load)

  return (
    <Modal title={file.name} onClose={onClose} wide>
      <div className="preview">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!preview && !error && <p>Loading preview…</p>}
        {preview && <PreviewBody preview={preview} />}
        {preview?.truncated && <p className="hint">Only the beginning is shown. Download the file to see all of it.</p>}
        <p className="hint">Text-only preview: formatting and pictures are not shown.</p>
        <div className="form-actions">
          <a className="button" href={api.contentUrl(file.id, true)}>
            <Icon name="download" size={18} /> Download
          </a>
        </div>
      </div>
    </Modal>
  )
}

// --- Move to another folder ---------------------------------------------------------------

type MoveProps = {
  api: FilesApi
  files: FileItem[]
  folders: Folder[]
  rootName: string
  onClose: () => void
  onMoved: () => Promise<unknown>
}

/** Folders in display order, each with how deep it is. */
function tree(all: Folder[]): { folder: Folder; depth: number }[] {
  const byParent = new Map<number | null, Folder[]>()
  for (const folder of all) {
    byParent.set(folder.parent_id, [...(byParent.get(folder.parent_id) ?? []), folder])
  }
  const ordered: { folder: Folder; depth: number }[] = []
  const walk = (parent: number | null, depth: number) => {
    for (const folder of byParent.get(parent) ?? []) {
      ordered.push({ folder, depth })
      walk(folder.id, depth + 1)
    }
  }
  walk(null, 0)
  return ordered
}

export function MoveDialog({ api, files, folders, rootName, onClose, onMoved }: MoveProps) {
  const load = useCallback(() => api.folders(), [api])
  const { value: all, error } = useLoaded(load)
  const [target, setTarget] = useState<number | null | undefined>(undefined)

  const count = files.length + folders.length
  const single = count === 1 ? (files[0] ?? folders[0]).name : `${count} items`

  // A folder cannot be moved into itself or into something inside it.
  const blocked = useMemo(() => {
    const ids = new Set(folders.map((folder) => folder.id))
    let grew = true
    while (grew && all) {
      grew = false
      for (const folder of all) {
        if (folder.parent_id !== null && ids.has(folder.parent_id) && !ids.has(folder.id)) {
          ids.add(folder.id)
          grew = true
        }
      }
    }
    return ids
  }, [all, folders])

  async function move() {
    if (target === undefined) throw new Error('Choose where to move to.')
    try {
      for (const folder of folders) await api.moveFolder(folder.id, target)
      for (const file of files) await api.moveFile(file.id, target)
    } finally {
      await onMoved()
    }
  }

  return (
    <FormModal title={`Move ${single}`} submitLabel="Move here" onClose={onClose} onSubmit={move}>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!all && !error && <p>Loading folders…</p>}
      {all && (
        <fieldset className="folder-picker">
          <legend>Move to</legend>
          <label className="check">
            <input type="radio" name="target" checked={target === null} onChange={() => setTarget(null)} />
            <Icon name="drive" size={18} /> {rootName} (top level)
          </label>
          {tree(all).map(({ folder, depth }) => (
            <label className="check" key={folder.id} style={{ paddingLeft: 20 * (depth + 1) }}>
              <input
                type="radio"
                name="target"
                disabled={blocked.has(folder.id)}
                checked={target === folder.id}
                onChange={() => setTarget(folder.id)}
              />
              <Icon name="folder" size={18} /> {folder.name}
            </label>
          ))}
        </fieldset>
      )}
    </FormModal>
  )
}

// --- Shared links -------------------------------------------------------------------------

export function SharedLinksDialog({ api, noun, onClose }: { api: FilesApi; noun: string; onClose: () => void }) {
  const load = useCallback(() => api.shares(), [api])
  const { value: links, setValue: setLinks, error } = useLoaded(load)
  const [confirming, setConfirming] = useState<number | null>(null)
  const [copied, setCopied] = useState<number | null>(null)
  const action = useAction()

  async function revoke(link: SharedLink) {
    const done = await action.run(() => api.revokeShare(link.id))
    if (done) setLinks((links ?? []).filter((other) => other.id !== link.id))
    setConfirming(null)
  }

  async function copy(link: SharedLink) {
    try {
      await navigator.clipboard.writeText(link.link)
      setCopied(link.id)
    } catch {
      action.setError('Could not copy. Select the link and copy it yourself.')
    }
  }

  return (
    <Modal title="Shared links" onClose={onClose} wide>
      <div className="form">
        {(error || action.error) && (
          <p className="error" role="alert">
            {error || action.error}
          </p>
        )}
        <p className="hint">
          What you share now is saved as a package: find it in <Link to="/packages">Packages</Link>.
          Links sent before that are listed here.
        </p>
        {!links && !error && <p>Loading…</p>}
        {links?.length === 0 && (
          <p className="empty">No earlier links.</p>
        )}
        <ul className="link-list">
          {links?.map((link) => (
            <li key={link.id}>
              <div className="link-head">
                <strong>
                  {link.files.length === 0
                    ? `No ${noun}s left`
                    : link.files.map((file) => file.name).join(', ')}
                </strong>
                {link.expired && <span className="badge badge-danger">Expired</span>}
              </div>
              <p className="hint">
                To {link.friends.map((r) => r.email).join(', ') || 'nobody'} · sent{' '}
                {formatDate(link.created_at)}
                {link.expires_at && !link.expired && ` · works until ${formatDate(link.expires_at)}`}
              </p>
              <div className="link-row">
                <input
                  readOnly
                  value={link.link}
                  aria-label={`Link sent ${formatDate(link.created_at)}`}
                  onFocus={(event) => event.target.select()}
                />
                <button type="button" className="secondary" onClick={() => copy(link)}>
                  {copied === link.id ? 'Copied' : 'Copy'}
                </button>
                {confirming === link.id ? (
                  <>
                    <button type="button" className="danger" disabled={action.busy} onClick={() => revoke(link)}>
                      Stop sharing
                    </button>
                    <button type="button" className="secondary" onClick={() => setConfirming(null)}>
                      Keep
                    </button>
                  </>
                ) : (
                  <button type="button" className="secondary" onClick={() => setConfirming(link.id)}>
                    Revoke
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  )
}

// --- Photo viewer with slideshow ------------------------------------------------------------

type LightboxProps = {
  api: FilesApi
  files: FileItem[]
  index: number
  onIndex: (index: number) => void
  onClose: () => void
}

const SLIDE_SECONDS = 3

export function Lightbox({ api, files, index, onIndex, onClose }: LightboxProps) {
  const [playing, setPlaying] = useState(false)
  const file = files[index]
  const many = files.length > 1

  const step = useCallback(
    (by: number) => onIndex((index + by + files.length) % files.length),
    [files.length, index, onIndex],
  )

  useEffect(() => {
    if (!playing || !many) return
    const timer = setTimeout(() => step(1), SLIDE_SECONDS * 1000)
    return () => clearTimeout(timer)
  }, [playing, many, step])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'ArrowRight') step(1)
      if (event.key === 'ArrowLeft') step(-1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [step])

  const details = [
    file.width && file.height ? `${file.width} × ${file.height}` : null,
    formatBytes(file.size),
    file.taken_at ? `Taken ${formatDate(file.taken_at)}` : null,
    file.camera,
  ].filter(Boolean)

  return (
    <Modal title={file.name} onClose={onClose} wide>
      <div className="lightbox">
        <div className="lightbox-stage">
          {many && (
            <button type="button" className="icon-button" aria-label="Previous photo" onClick={() => step(-1)}>
              <Icon name="left" size={28} />
            </button>
          )}
          <img src={api.contentUrl(file.id)} alt={file.name} />
          {many && (
            <button type="button" className="icon-button" aria-label="Next photo" onClick={() => step(1)}>
              <Icon name="right" size={28} />
            </button>
          )}
        </div>
        <p className="hint" aria-live="polite">
          {many && `${index + 1} of ${files.length} · `}
          {details.join(' · ')}
        </p>
        <div className="toolbar">
          {many && (
            <button type="button" className="secondary" aria-pressed={playing} onClick={() => setPlaying(!playing)}>
              {playing ? 'Pause slideshow' : 'Play slideshow'}
            </button>
          )}
          <a className="button" href={api.contentUrl(file.id, true)}>
            <Icon name="download" size={18} /> Download
          </a>
        </div>
      </div>
    </Modal>
  )
}
