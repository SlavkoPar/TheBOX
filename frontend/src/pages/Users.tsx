import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { adminApi, errorMessage } from '../api'
import type { AdminUser } from '../api'
import { useAuth } from '../auth'
import ViewToggle from '../common/ViewToggle'
import { formatBytes, formatDate } from '../common/format'
import { useViewMode } from '../common/useViewMode'

function Status({ user }: { user: AdminUser }) {
  return user.is_confirmed ? (
    <span className="badge">Confirmed</span>
  ) : (
    <span className="badge badge-danger">Not confirmed</span>
  )
}

const stored = (user: AdminUser) =>
  `${user.file_count} ${user.file_count === 1 ? 'file' : 'files'} · ${formatBytes(user.storage_used)}`

/** Administrators only: everyone who registered. The server refuses anyone else. */
export default function Users() {
  const { user: me, loading } = useAuth()
  const isAdmin = Boolean(me?.is_admin)
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState('')
  const [mode, setMode] = useViewMode('users', 'list')

  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    adminApi
      .users()
      .then((items) => {
        if (!cancelled) setUsers(items)
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [isAdmin])

  if (loading) return <p>Loading…</p> // not known yet who is signed in
  if (!isAdmin) return <Navigate to="/" replace />

  const confirmed = users?.filter((user) => user.is_confirmed).length ?? 0

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Users</h2>
          <p className="hint">
            {users
              ? `${users.length} registered, ${confirmed} confirmed. Newest first.`
              : 'Everyone who registered.'}
          </p>
        </div>
        <ViewToggle mode={mode} onChange={setMode} />
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!users && !error && <p>Loading…</p>}

      {users && mode === 'list' && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Status</th>
                <th>Registered</th>
                <th>Confirmed</th>
                <th>Files</th>
                <th>Storage</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <a href={`mailto:${user.email}`}>{user.email}</a>
                    {user.is_admin && <span className="badge">Admin</span>}
                    {user.id === me?.id && <span className="badge">You</span>}
                  </td>
                  <td>
                    <Status user={user} />
                  </td>
                  <td>{formatDate(user.created_at)}</td>
                  <td>{user.confirmed_at ? formatDate(user.confirmed_at) : '—'}</td>
                  <td>{user.file_count}</td>
                  <td>{formatBytes(user.storage_used)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {users && mode === 'grid' && (
        <ul className="card-grid" aria-label="Users">
          {users.map((user) => (
            <li key={user.id} aria-label={user.email}>
              <a href={`mailto:${user.email}`}>{user.email}</a>
              <span className="card-badges">
                <Status user={user} />
                {user.is_admin && <span className="badge">Admin</span>}
                {user.id === me?.id && <span className="badge">You</span>}
              </span>
              <span className="hint">Registered {formatDate(user.created_at)}</span>
              <span className="hint">{stored(user)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
