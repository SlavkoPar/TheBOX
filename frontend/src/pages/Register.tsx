import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'

const MIN_PASSWORD_LENGTH = 8

export default function Register() {
  const { user } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to="/" replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (password !== repeat) {
      setError('The passwords do not match.')
      return
    }
    setBusy(true)
    try {
      await api.register(email, password)
      setSentTo(email.trim())
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (sentTo) {
    return (
      <div className="card">
        <h2>Check your inbox</h2>
        <p>
          We sent a confirmation link to <strong>{sentTo}</strong>. Open it to activate your
          account, then sign in.
        </p>
        <p className="hint">
          <Link to="/login">Go to sign in</Link>
        </p>
      </div>
    )
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <h2>Create account</h2>

      <label>
        Email
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label>
        Password
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <small>At least {MIN_PASSWORD_LENGTH} characters.</small>
      </label>
      <label>
        Repeat password
        <input
          type="password"
          autoComplete="new-password"
          required
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
        />
      </label>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy}>
        Create account
      </button>
      <p className="hint">
        Already registered? <Link to="/login">Sign in</Link>
      </p>
    </form>
  )
}
