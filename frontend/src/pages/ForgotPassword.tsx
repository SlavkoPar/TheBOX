import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAction } from '../common/useAction'

/** Ask for an email with a link to set a new password. */
export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [notice, setNotice] = useState('')
  const { busy, error, run } = useAction()

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setNotice('')
    void run(async () => setNotice((await api.forgotPassword(email)).message))
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <h2>Forgot your password?</h2>
      <p className="hint">Enter your email address and we will send you a link to set a new one.</p>

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

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

      <button type="submit" disabled={busy}>
        Send the link
      </button>
      <p className="hint">
        <Link to="/login">Back to sign in</Link>
      </p>
    </form>
  )
}
