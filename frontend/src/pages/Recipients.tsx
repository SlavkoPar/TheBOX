import { useState } from 'react'
import { recipientsApi } from '../api'
import type { Recipient, RecipientInput } from '../api'
import { ConfirmDialog, FormModal } from '../common/Modal'
import { Icon } from '../common/icons'
import { useCollection } from '../common/useCollection'

const EMPTY: RecipientInput = {
  first_name: '',
  last_name: '',
  email: '',
  address: '',
  country: '',
  mobile: '',
}

const FIELDS: { key: keyof RecipientInput; label: string; type?: string; required?: boolean }[] = [
  { key: 'first_name', label: 'First name', required: true },
  { key: 'last_name', label: 'Last name' },
  { key: 'email', label: 'Email', type: 'email', required: true },
  { key: 'address', label: 'Address' },
  { key: 'country', label: 'Country' },
  { key: 'mobile', label: 'Mobile', type: 'tel' },
]

type FormProps = {
  recipient: Recipient | null
  onClose: () => void
  onSave: (data: RecipientInput) => Promise<unknown>
}

function RecipientForm({ recipient, onClose, onSave }: FormProps) {
  const [values, setValues] = useState<RecipientInput>(() =>
    recipient ? { ...EMPTY, ...pick(recipient) } : EMPTY,
  )

  return (
    <FormModal
      title={recipient ? 'Edit recipient' : 'New recipient'}
      submitLabel={recipient ? 'Save' : 'Add recipient'}
      onClose={onClose}
      onSubmit={() => onSave(values)}
    >
      <div className="form-grid">
        {FIELDS.map(({ key, label, type = 'text', required }) => (
          <label key={key} className={key === 'address' ? 'span-2' : undefined}>
            {label}
            <input
              type={type}
              value={values[key]}
              required={required}
              onChange={(event) => setValues({ ...values, [key]: event.target.value })}
            />
          </label>
        ))}
      </div>
    </FormModal>
  )
}

function pick(recipient: Recipient): RecipientInput {
  const { first_name, last_name, email, address, country, mobile } = recipient
  return { first_name, last_name, email, address, country, mobile }
}

export default function Recipients() {
  const { items, loading, error, create, update, remove } = useCollection(recipientsApi)
  const [editing, setEditing] = useState<Recipient | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Recipient | null>(null)

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Recipients</h2>
          <p className="hint">People you can send links to from Drive and Photos.</p>
        </div>
        <button type="button" onClick={() => setEditing('new')}>
          <Icon name="plus" size={18} /> New recipient
        </button>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : items.length === 0 ? (
        <p className="empty">No recipients yet. Add the people you want to share with.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>First name</th>
                <th>Last name</th>
                <th>Email</th>
                <th>Address</th>
                <th>Country</th>
                <th>Mobile</th>
                <th>
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((recipient) => (
                <tr key={recipient.id}>
                  <td>{recipient.first_name}</td>
                  <td>{recipient.last_name}</td>
                  <td>
                    <a href={`mailto:${recipient.email}`}>{recipient.email}</a>
                  </td>
                  <td>{recipient.address}</td>
                  <td>{recipient.country}</td>
                  <td>{recipient.mobile}</td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Edit ${recipient.first_name} ${recipient.last_name}`.trim()}
                      onClick={() => setEditing(recipient)}
                    >
                      <Icon name="edit" />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Delete ${recipient.first_name} ${recipient.last_name}`.trim()}
                      onClick={() => setDeleting(recipient)}
                    >
                      <Icon name="trash" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <RecipientForm
          recipient={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(data) => (editing === 'new' ? create(data) : update(editing.id, data))}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete recipient"
          message={`Delete ${deleting.first_name} ${deleting.last_name} (${deleting.email})?`}
          confirmLabel="Delete"
          onClose={() => setDeleting(null)}
          onConfirm={() => remove(deleting.id)}
        />
      )}
    </div>
  )
}
