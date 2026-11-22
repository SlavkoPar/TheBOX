import { useEffect, useId, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Icon } from './icons'
import { useAction } from './useAction'

type ModalProps = {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}

/** Dialog over the page. Closes on Escape, on the × button and on a click outside. */
export function Modal({ title, onClose, children, wide = false }: ModalProps) {
  const titleId = useId()

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className={wide ? 'modal modal-wide' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}

type FormModalProps = {
  title: string
  submitLabel: string
  onClose: () => void
  /** Called on submit. The dialog closes when it resolves and shows the error if it rejects. */
  onSubmit: () => Promise<unknown>
  children: ReactNode
  wide?: boolean
  danger?: boolean
}

/** A Modal with a form, Cancel / submit buttons, a busy state and error display. */
export function FormModal({
  title,
  submitLabel,
  onClose,
  onSubmit,
  children,
  wide,
  danger,
}: FormModalProps) {
  const { busy, error, run } = useAction()

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (await run(onSubmit)) onClose()
  }

  return (
    <Modal title={title} onClose={onClose} wide={wide}>
      <form className="form" onSubmit={submit}>
        {children}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={danger ? 'danger' : undefined} disabled={busy}>
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  )
}

type PromptProps = {
  title: string
  label: string
  submitLabel: string
  initial?: string
  type?: 'text' | 'password'
  hint?: ReactNode
  minLength?: number
  onClose: () => void
  onSubmit: (value: string) => Promise<unknown>
}

/** Asks for one value: a name, a password. */
export function PromptDialog({
  title,
  label,
  submitLabel,
  initial = '',
  type = 'text',
  hint,
  minLength,
  onClose,
  onSubmit,
}: PromptProps) {
  const [value, setValue] = useState(initial)

  return (
    <FormModal
      title={title}
      submitLabel={submitLabel}
      onClose={onClose}
      onSubmit={() => onSubmit(value)}
    >
      <label>
        {label}
        <input
          type={type}
          value={value}
          required
          minLength={minLength}
          autoFocus
          autoComplete={type === 'password' ? 'off' : undefined}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      {hint && <p className="hint">{hint}</p>}
    </FormModal>
  )
}

type ConfirmProps = {
  title: string
  message: ReactNode
  confirmLabel: string
  onClose: () => void
  onConfirm: () => Promise<unknown>
}

/** Asks before something that cannot be undone. */
export function ConfirmDialog({ title, message, confirmLabel, onClose, onConfirm }: ConfirmProps) {
  return (
    <FormModal title={title} submitLabel={confirmLabel} onClose={onClose} onSubmit={onConfirm} danger>
      <p>{message}</p>
    </FormModal>
  )
}
