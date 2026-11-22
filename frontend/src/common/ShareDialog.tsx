import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { errorMessage, recipientsApi } from '../api'
import type { FileItem, FilesApi, Recipient, ShareResult } from '../api'
import { Modal } from './Modal'
import { useAction } from './useAction'

type Props = {
  api: FilesApi
  files: FileItem[]
  /** "document" or "photo" */
  noun: string
  onClose: () => void
}

/** Pick recipients and email them a link to the selected files. */
export default function ShareDialog({ api, files, noun, onClose }: Props) {
  const [recipients, setRecipients] = useState<Recipient[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [chosen, setChosen] = useState<Set<number>>(new Set())
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<ShareResult | null>(null)
  const { busy, error, setError, run } = useAction()

  useEffect(() => {
    let cancelled = false
    recipientsApi
      .list()
      .then((items) => {
        if (!cancelled) setRecipients(items)
      })
      .catch((err) => {
        if (!cancelled) setLoadError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const plural = files.length === 1 ? noun : `${noun}s`
  const title = `Share ${files.length} ${plural}`
  const hasEncrypted = files.some((file) => file.is_encrypted)
  const allChosen = recipients !== null && recipients.length > 0 && chosen.size === recipients.length

  function toggle(id: number) {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setChosen(next)
  }

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
          {files.map((file) => (
            <li key={file.id}>{file.name}</li>
          ))}
        </ul>

        {loadError && (
          <p className="error" role="alert">
            {loadError}
          </p>
        )}

        {recipients === null && !loadError && <p>Loading recipients…</p>}

        {recipients !== null && recipients.length === 0 && (
          <p className="empty">
            You have no recipients yet. <Link to="/recipients">Add recipients</Link> first.
          </p>
        )}

        {recipients !== null && recipients.length > 0 && (
          <fieldset className="recipient-picker">
            <legend>Send to</legend>
            <label className="check">
              <input
                type="checkbox"
                checked={allChosen}
                onChange={() =>
                  setChosen(allChosen ? new Set() : new Set(recipients.map((r) => r.id)))
                }
              />
              <strong>Everyone</strong>
            </label>
            {recipients.map((recipient) => (
              <label className="check" key={recipient.id}>
                <input
                  type="checkbox"
                  checked={chosen.has(recipient.id)}
                  onChange={() => toggle(recipient.id)}
                />
                <span>
                  {`${recipient.first_name} ${recipient.last_name}`.trim()}{' '}
                  <small>{recipient.email}</small>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        <label>
          Message (optional)
          <textarea rows={3} value={message} onChange={(event) => setMessage(event.target.value)} />
        </label>

        <p className="hint">
          Each recipient gets an email with a link to view or download{' '}
          {files.length === 1 ? `this ${noun}` : `these ${plural}`}. Anyone with the link can open
          it.
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
