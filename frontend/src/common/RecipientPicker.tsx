import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { errorMessage, recipientsApi } from '../api'
import type { Recipient } from '../api'

/** Loads the recipients when a dialog opens; null while loading. */
export function useRecipients() {
  const [recipients, setRecipients] = useState<Recipient[] | null>(null)
  const [loadError, setLoadError] = useState('')

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

  return { recipients, loadError }
}

type Props = {
  recipients: Recipient[] | null
  loadError: string
  chosen: Set<number>
  onChange: (chosen: Set<number>) => void
}

/** Checkboxes for choosing who gets a link: used when sharing and in packages. */
export default function RecipientPicker({ recipients, loadError, chosen, onChange }: Props) {
  const allChosen = recipients !== null && recipients.length > 0 && chosen.size === recipients.length

  function toggle(id: number) {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }

  return (
    <>
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
              onChange={() => onChange(allChosen ? new Set() : new Set(recipients.map((r) => r.id)))}
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
    </>
  )
}
