import { useState } from 'react'
import { errorMessage } from '../api'
import { useAuth } from '../auth'

export default function Home() {
  const { user, logout } = useAuth()
  const [error, setError] = useState('')

  async function onLogout() {
    setError('')
    try {
      await logout()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div className="card">
      <h2>Welcome</h2>
      <p>
        Signed in as <strong>{user?.email}</strong>.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="secondary" onClick={onLogout}>
        Sign out
      </button>
    </div>
  )
}
