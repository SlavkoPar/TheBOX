import { useState } from 'react'
import { friendsApi } from '../api'
import type { Friend, FriendInput } from '../api'
import { ConfirmDialog, FormModal } from '../common/Modal'
import ViewToggle from '../common/ViewToggle'
import { Icon } from '../common/icons'
import { useMessenger } from '../common/messengerContext'
import { useCollection } from '../common/useCollection'
import { useViewMode } from '../common/useViewMode'

const EMPTY: FriendInput = {
  first_name: '',
  last_name: '',
  email: '',
  address: '',
  country: '',
  mobile: '',
}

const FIELDS: { key: keyof FriendInput; label: string; type?: string; required?: boolean }[] = [
  { key: 'first_name', label: 'First name', required: true },
  { key: 'last_name', label: 'Last name' },
  { key: 'email', label: 'Email', type: 'email', required: true },
  { key: 'address', label: 'Address' },
  { key: 'country', label: 'Country' },
  { key: 'mobile', label: 'Mobile', type: 'tel' },
]

type FormProps = {
  friend: Friend | null
  onClose: () => void
  onSave: (data: FriendInput) => Promise<unknown>
}

function FriendForm({ friend, onClose, onSave }: FormProps) {
  const [values, setValues] = useState<FriendInput>(() =>
    friend ? { ...EMPTY, ...pick(friend) } : EMPTY,
  )

  return (
    <FormModal
      title={friend ? 'Edit friend' : 'New friend'}
      submitLabel={friend ? 'Save' : 'Add friend'}
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

function pick(friend: Friend): FriendInput {
  const { first_name, last_name, email, address, country, mobile } = friend
  return { first_name, last_name, email, address, country, mobile }
}

export default function Friends() {
  const { items, loading, error, create, update, remove } = useCollection(friendsApi)
  const [editing, setEditing] = useState<Friend | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Friend | null>(null)
  const [mode, setMode] = useViewMode('friends', 'list')
  const messenger = useMessenger()

  const fullName = (friend: Friend) => `${friend.first_name} ${friend.last_name}`.trim()

  function actions(friend: Friend) {
    return (
      <>
        <button
          type="button"
          className="icon-button"
          aria-label={`Message ${fullName(friend)}`}
          title="Message"
          onClick={() => messenger.open(friend.email)}
        >
          <Icon name="chat" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`Edit ${fullName(friend)}`}
          title="Edit"
          onClick={() => setEditing(friend)}
        >
          <Icon name="edit" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`Delete ${fullName(friend)}`}
          title="Delete"
          onClick={() => setDeleting(friend)}
        >
          <Icon name="trash" />
        </button>
      </>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Friends</h2>
          <p className="hint">People you can send links to from Drive and Photos, and chat with in Messenger.</p>
        </div>
        <div className="toolbar">
          <ViewToggle mode={mode} onChange={setMode} />
          <button type="button" onClick={() => setEditing('new')}>
            <Icon name="plus" size={18} /> New friend
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
        <p className="empty">No friends yet. Add the people you want to share with.</p>
      ) : mode === 'grid' ? (
        <ul className="card-grid" aria-label="Friends">
          {items.map((friend) => (
            <li key={friend.id} aria-label={fullName(friend)}>
              <div className="card-head">
                <strong>{fullName(friend)}</strong>
                <span className="spacer" />
                <span className="row-actions">{actions(friend)}</span>
              </div>
              <a href={`mailto:${friend.email}`}>{friend.email}</a>
              {friend.mobile && <span>{friend.mobile}</span>}
              {(friend.address || friend.country) && (
                <span className="hint">
                  {[friend.address, friend.country].filter(Boolean).join(', ')}
                </span>
              )}
            </li>
          ))}
        </ul>
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
              {items.map((friend) => (
                <tr key={friend.id}>
                  <td>{friend.first_name}</td>
                  <td>{friend.last_name}</td>
                  <td>
                    <a href={`mailto:${friend.email}`}>{friend.email}</a>
                  </td>
                  <td>{friend.address}</td>
                  <td>{friend.country}</td>
                  <td>{friend.mobile}</td>
                  <td className="row-actions">{actions(friend)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <FriendForm
          friend={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(data) => (editing === 'new' ? create(data) : update(editing.id, data))}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete friend"
          message={`Delete ${deleting.first_name} ${deleting.last_name} (${deleting.email})?`}
          confirmLabel="Delete"
          onClose={() => setDeleting(null)}
          onConfirm={() => remove(deleting.id)}
        />
      )}
    </div>
  )
}
