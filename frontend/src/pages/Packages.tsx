import { useState } from 'react'
import type { FormEvent } from 'react'
import { packagesApi } from '../api'
import type { Package, PackageInput, PackageSend, ShareResult } from '../api'
import ItemPicker from '../common/ItemPicker'
import { ConfirmDialog, Modal } from '../common/Modal'
import ViewToggle from '../common/ViewToggle'
import RecipientPicker, { useRecipients } from '../common/RecipientPicker'
import { formatDate, formatTime } from '../common/format'
import { Icon } from '../common/icons'
import { itemKey, locationOf } from '../common/items'
import type { PickedItem } from '../common/items'
import { useAction } from '../common/useAction'
import { useCollection } from '../common/useCollection'
import { useViewMode } from '../common/useViewMode'

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

function itemsOf(pkg: Package): PickedItem[] {
  return [
    ...pkg.folders.map((f) => ({ kind: 'folder' as const, id: f.id, app: f.app, name: f.name, path: f.path })),
    ...pkg.files.map((f) => ({ kind: 'file' as const, id: f.id, app: f.app, name: f.name, path: f.path })),
  ]
}

// --- Create / edit ----------------------------------------------------------------------

type FormProps = {
  pkg: Package | null
  onClose: () => void
  onSave: (data: PackageInput) => Promise<unknown>
}

function PackageForm({ pkg, onClose, onSave }: FormProps) {
  const [name, setName] = useState(pkg?.name ?? '')
  const [message, setMessage] = useState(pkg?.message ?? '')
  const [items, setItems] = useState<PickedItem[]>(() => (pkg ? itemsOf(pkg) : []))
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(pkg?.recipients.map((r) => r.id)))
  const [picking, setPicking] = useState(false)
  const { recipients, loadError } = useRecipients()
  const { busy, error, setError, run } = useAction()

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (items.length === 0) {
      setError('Add at least one file or folder.')
      return
    }
    const ids = (kind: PickedItem['kind']) => items.filter((i) => i.kind === kind).map((i) => i.id)
    const saved = await run(() =>
      onSave({
        name,
        message,
        file_ids: ids('file'),
        folder_ids: ids('folder'),
        recipient_ids: [...chosen],
      }),
    )
    if (saved) onClose()
  }

  if (picking) {
    // Escape and × go back to the form, so what was typed there is not lost.
    return (
      <Modal title="Add files and folders" onClose={() => setPicking(false)} wide>
        <div className="form">
          <ItemPicker picked={items} onChange={setItems} />
          <div className="form-actions">
            <button type="button" onClick={() => setPicking(false)}>
              Done
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={pkg ? 'Edit package' : 'New package'} onClose={onClose} wide>
      <form className="form" onSubmit={submit}>
        <label>
          Name
          <input value={name} required autoFocus onChange={(event) => setName(event.target.value)} />
        </label>

        <fieldset className="package-items">
          <legend>Contents</legend>
          {items.length === 0 && <p className="hint">Nothing added yet.</p>}
          {items.length > 0 && (
            <ul aria-label="Package contents">
              {items.map((item) => (
                <li key={itemKey(item)}>
                  <span className="item-name">
                    <Icon name={item.kind === 'folder' ? 'folder' : 'file'} /> {item.name}
                  </span>
                  <small>
                    {item.kind === 'folder' && 'folder · '}in {locationOf(item)}
                  </small>
                  <span className="spacer" />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${item.name}`}
                    title="Remove from the package"
                    onClick={() => setItems(items.filter((other) => itemKey(other) !== itemKey(item)))}
                  >
                    <Icon name="close" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="secondary" onClick={() => setPicking(true)}>
            <Icon name="plus" size={18} /> Add files or folders
          </button>
        </fieldset>

        <RecipientPicker recipients={recipients} loadError={loadError} chosen={chosen} onChange={setChosen} />

        <label>
          Message (optional)
          <textarea rows={3} value={message} onChange={(event) => setMessage(event.target.value)} />
        </label>

        <p className="hint">
          Saving does not email anyone: press Send on the package when it is ready. A folder in a
          package always shows what is in that folder now.
        </p>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="form-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" disabled={busy}>
            {pkg ? 'Save' : 'Create package'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// --- Send ---------------------------------------------------------------------------------

type SendProps = {
  pkg: Package
  onClose: () => void
  onSend: () => Promise<ShareResult>
}

function SendDialog({ pkg, onClose, onSend }: SendProps) {
  const [result, setResult] = useState<ShareResult | null>(null)
  const { busy, error, run } = useAction()
  const title = `Send “${pkg.name}”`
  const problem =
    pkg.recipients.length === 0
      ? 'This package has no recipients. Edit it to choose who gets it.'
      : pkg.file_count === 0
        ? 'This package has no files to send. Edit it to add some.'
        : ''

  if (result) {
    return (
      <Modal title={title} onClose={onClose}>
        <div className="form">
          {result.sent.length > 0 && (
            <p className="notice" role="status">
              Link emailed to {result.sent.join(', ')}.
            </p>
          )}
          {result.failed.length > 0 && (
            <p className="error" role="alert">
              The email could not be sent to {result.failed.join(', ')}. You can send them the link
              yourself.
            </p>
          )}
          <label>
            Link
            <input readOnly value={result.link} onFocus={(event) => event.target.select()} />
          </label>
          <div className="form-actions">
            <button type="button" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={title} onClose={onClose}>
      <div className="form">
        {problem ? (
          <p className="error" role="alert">
            {problem}
          </p>
        ) : (
          <p>
            Email the link to {count(pkg.file_count, 'file')} to{' '}
            {pkg.recipients.map((r) => r.email).join(', ')}?
          </p>
        )}
        {pkg.sends.length > 0 && !problem && (
          <p className="hint">Already sent {count(pkg.sends.length, 'time')}. This sends it again.</p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || problem !== ''}
            onClick={() => run(async () => setResult(await onSend()))}
          >
            <Icon name="send" size={18} /> Send
          </button>
        </div>
      </div>
    </Modal>
  )
}

// --- One package in the list ------------------------------------------------------------

function SendRecord({ send }: { send: PackageSend }) {
  return (
    <li>
      <strong>
        {formatDate(send.sent_at)}, {formatTime(send.sent_at)}
      </strong>
      <span>
        To{' '}
        {send.recipients.map((r, index) => (
          <span key={r.email}>
            {index > 0 && ', '}
            {r.name ? `${r.name} (${r.email})` : r.email}
            {!r.sent && <span className="badge badge-danger">not delivered</span>}
          </span>
        ))}
      </span>
      <span className="hint">
        {send.items
          .map((item) =>
            item.kind === 'folder' ? `${item.name} (folder, ${count(item.file_count ?? 0, 'file')})` : item.name,
          )
          .join(', ')}
      </span>
      {send.message && <span className="hint">“{send.message}”</span>}
    </li>
  )
}

type CardProps = {
  pkg: Package
  onEdit: () => void
  onSend: () => void
  onDelete: () => void
}

function PackageCard({ pkg, onEdit, onSend, onDelete }: CardProps) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const last = pkg.sends[0]

  async function copy() {
    try {
      await navigator.clipboard.writeText(pkg.link)
      setCopied(true)
    } catch {
      setCopyError(true)
    }
  }

  return (
    <li aria-label={pkg.name}>
      <div className="package-head">
        <h3>{pkg.name}</h3>
        {pkg.expired && <span className="badge badge-danger">Link expired</span>}
        {!last && <span className="badge">Not sent yet</span>}
        <span className="spacer" />
        <button type="button" onClick={onSend} aria-label={`Send ${pkg.name}`}>
          <Icon name="send" size={18} /> {last ? 'Send again' : 'Send'}
        </button>
        <button type="button" className="icon-button" aria-label={`Edit ${pkg.name}`} title="Edit" onClick={onEdit}>
          <Icon name="edit" />
        </button>
        <button type="button" className="icon-button" aria-label={`Delete ${pkg.name}`} title="Delete" onClick={onDelete}>
          <Icon name="trash" />
        </button>
      </div>

      <p className="hint">
        {count(pkg.file_count, 'file')} · to {pkg.recipients.map((r) => r.email).join(', ') || 'nobody yet'}
        {last && ` · last sent ${formatDate(last.sent_at)}`}
        {pkg.expires_at && !pkg.expired && ` · link works until ${formatDate(pkg.expires_at)}`}
      </p>

      {pkg.folders.length + pkg.files.length === 0 ? (
        <p className="hint">Its files and folders were deleted.</p>
      ) : (
        <ul className="package-contents" aria-label={`Contents of ${pkg.name}`}>
          {pkg.folders.map((folder) => (
            <li key={`folder-${folder.id}`}>
              <span className="item-name">
                <Icon name="folder" size={18} /> {folder.name}
              </span>
              <small>
                {count(folder.file_count, 'file')} · in {locationOf(folder)}
              </small>
            </li>
          ))}
          {pkg.files.map((file) => (
            <li key={file.id}>
              <span className="item-name">
                <Icon name={file.is_encrypted ? 'lock' : 'file'} size={18} /> {file.name}
              </span>
              <small>in {locationOf(file)}</small>
            </li>
          ))}
        </ul>
      )}

      {pkg.message && <blockquote className="share-message">{pkg.message}</blockquote>}

      <div className="link-row">
        <input
          readOnly
          value={pkg.link}
          aria-label={`Link of ${pkg.name}`}
          onFocus={(event) => event.target.select()}
        />
        <button type="button" className="secondary" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {copyError && <p className="hint">Could not copy. Select the link and copy it yourself.</p>}

      {pkg.sends.length > 0 && (
        <details className="package-history">
          <summary>History: sent {count(pkg.sends.length, 'time')}</summary>
          <ul aria-label={`History of ${pkg.name}`}>
            {pkg.sends.map((send) => (
              <SendRecord key={send.id} send={send} />
            ))}
          </ul>
        </details>
      )}
    </li>
  )
}

// --- Page -----------------------------------------------------------------------------------

export default function Packages() {
  const { items, loading, error, reload, create, update, remove } = useCollection(packagesApi)
  const [editing, setEditing] = useState<Package | 'new' | null>(null)
  const [sending, setSending] = useState<Package | null>(null)
  const [deleting, setDeleting] = useState<Package | null>(null)
  const [mode, setMode] = useViewMode('packages', 'list')

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Packages</h2>
          <p className="hint">
            Put files and folders from anywhere in Drive and Photos behind one link, send it to
            recipients, and keep a record of what was sent.
          </p>
        </div>
        <div className="toolbar">
          <ViewToggle mode={mode} onChange={setMode} />
          <button type="button" onClick={() => setEditing('new')}>
            <Icon name="plus" size={18} /> New package
          </button>
        </div>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : items.length === 0 ? (
        <p className="empty">No packages yet. Create one to send files to your recipients.</p>
      ) : (
        <ul className={mode === 'grid' ? 'package-list grid' : 'package-list'} aria-label="Packages">
          {items.map((pkg) => (
            <PackageCard
              key={pkg.id}
              pkg={pkg}
              onEdit={() => setEditing(pkg)}
              onSend={() => setSending(pkg)}
              onDelete={() => setDeleting(pkg)}
            />
          ))}
        </ul>
      )}

      {editing && (
        <PackageForm
          pkg={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(data) => (editing === 'new' ? create(data) : update(editing.id, data))}
        />
      )}

      {sending && (
        <SendDialog
          pkg={sending}
          onClose={() => setSending(null)}
          onSend={async () => {
            const result = await packagesApi.send(sending.id)
            await reload()
            return result
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete package"
          message={`Delete “${deleting.name}” and its history? Its link stops working. The files stay in Drive and Photos.`}
          confirmLabel="Delete"
          onClose={() => setDeleting(null)}
          onConfirm={() => remove(deleting.id)}
        />
      )}
    </div>
  )
}
