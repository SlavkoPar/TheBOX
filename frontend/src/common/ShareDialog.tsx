import { useState } from 'react'
import type { FormEvent } from 'react'
import type { FileItem, FilesApi, Folder, ShareResult } from '../api'
import { Modal } from './Modal'
import RecipientPicker, { useRecipients } from './RecipientPicker'
import { useAction } from './useAction'

type Props = {
  api: FilesApi
  files: FileItem[]
  /** Folders to share: every file inside them is included. */
  folders?: Folder[]
  /** "document" or "photo" */
  noun: string
  folderNoun?: string
  onClose: () => void
}

/** Pick recipients and email them a link to the selected files. */
export default function ShareDialog({
  api,
  files,
  folders = [],
  noun,
  folderNoun = 'folder',
  onClose,
}: Props) {
  const { recipients, loadError } = useRecipients()
  const [chosen, setChosen] = useState<Set<number>>(new Set())
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<ShareResult | null>(null)
  const { busy, error, setError, run } = useAction()

  const plural = files.length === 1 ? noun : `${noun}s`
  const counts = [
    folders.length > 0 && `${folders.length} ${folderNoun}${folders.length === 1 ? '' : 's'}`,
    files.length > 0 && `${files.length} ${plural}`,
  ].filter(Boolean)
  const title = `Share ${counts.join(' and ')}`
  const hasEncrypted = files.some((file) => file.is_encrypted)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (chosen.size === 0) {
      setError('Select at least one recipient.')
      return
    }
    await run(async () => {
      setResult(
        await api.share(
          files.map((file) => file.id),
          folders.map((folder) => folder.id),
          [...chosen],
          message,
        ),
      )
    })
  }

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
              The email could not be sent to {result.failed.join(', ')}. You can send them the
              link yourself.
            </p>
          )}
          <label>
            Link
            <input readOnly value={result.link} onFocus={(event) => event.target.select()} />
          </label>
          {hasEncrypted && (
            <p className="hint">
              Encrypted documents open only with their password. Give it to the recipients
              yourself — it is not in the email.
            </p>
          )}
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
      <form className="form" onSubmit={submit}>
        <ul className="share-files">
          {folders.map((folder) => (
            <li key={`folder-${folder.id}`}>
              {folder.name} <small>(everything in this {folderNoun})</small>
            </li>
          ))}
          {files.map((file) => (
            <li key={file.id}>{file.name}</li>
          ))}
        </ul>

        <RecipientPicker
          recipients={recipients}
          loadError={loadError}
          chosen={chosen}
          onChange={setChosen}
        />

        <label>
          Message (optional)
          <textarea rows={3} value={message} onChange={(event) => setMessage(event.target.value)} />
        </label>

        <p className="hint">
          Each recipient gets an email with a link to view or download{' '}
          {folders.length === 0 && files.length === 1 ? `this ${noun}` : `these ${noun}s`}. Anyone
          with the link can open it.
          {folders.length > 0 &&
            ` A shared ${folderNoun} includes what is in it now, not what is added later.`}
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
          <button type="submit" disabled={busy || !recipients || recipients.length === 0}>
            Send link
          </button>
        </div>
      </form>
    </Modal>
  )
}
