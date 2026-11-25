import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAction } from '../common/useAction'

const MIN_PASSWORD_LENGTH = 8

/** Where the emailed "forgot password" link leads: choose a new password. */
export default function ResetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [done, setDone] = useState('')
  const { busy, error, setError, run } = useAction()

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (password !== repeat) {
      setError('The passwords do not match.')
      return
    }
    void run(async () => setDone((await api.resetPassword(token ?? '', password)).message))
  }

  if (!token || done) {
    return (
      <div className="card">
        <h2>New password</h2>
        {done ? (
          <p className="notice" role="status">
            {done}
          </p>
        ) : (
          <p className="error" role="alert">
            This link is not valid. Ask for a new one.
          </p>
        )}
        <p className="hint">
          {done ? <Link to="/login">Go to sign in</Link> : <Link to="/forgot-password">Ask for a new link</Link>}
        </p>
      </div>
    )
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <h2>New password</h2>

      <label>
        New password
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label>
        Repeat the new password
        <input
          type="password"
          autoComplete="new-password"
          required
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
        />
      </label>

      {error && (
        <>
          <p className="error" role="alert">
            {error}
          </p>
          <p className="hint">
            <Link to="/forgot-password">Ask for a new link</Link>
          </p>
        </>
      )}

      <button type="submit" disabled={busy}>
        Save the new password
      </button>
    </form>
  )
}
