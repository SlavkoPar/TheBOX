import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { ApiError, api, errorMessage } from '../api'
import { useAuth } from '../auth'

export default function Login() {
  const { user, login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [unconfirmed, setUnconfirmed] = useState(false)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to="/" replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setNotice('')
    setUnconfirmed(false)
    setBusy(true)
    try {
      await login(email, password)
    } catch (err) {
      setError(errorMessage(err))
      setUnconfirmed(err instanceof ApiError && err.code === 'email_not_confirmed')
    } finally {
      setBusy(false)
    }
  }

  async function resend() {
    setBusy(true)
    try {
      const data = await api.resendConfirmation(email)
      setError('')
      setUnconfirmed(false)
      setNotice(data.message)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <h2>Sign in</h2>

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
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {unconfirmed && (
        <button type="button" className="secondary" onClick={resend} disabled={busy}>
          Resend confirmation email
        </button>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

      <button type="submit" disabled={busy}>
        Sign in
      </button>
      <p className="hint">
        <Link to="/forgot-password">Forgot your password?</Link>
      </p>
      <p className="hint">
        No account yet? <Link to="/register">Create one</Link>
      </p>
    </form>
  )
}
