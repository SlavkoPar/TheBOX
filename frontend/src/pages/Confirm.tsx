import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, errorMessage } from '../api'

type Result = { ok: boolean; message: string }

export default function Confirm() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const [result, setResult] = useState<Result | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    api
      .confirm(token)
      .then((data) => {
        if (!cancelled) setResult({ ok: true, message: data.message })
      })
      .catch((err) => {
        if (!cancelled) setResult({ ok: false, message: errorMessage(err) })
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const shown: Result | null = token
    ? result
    : { ok: false, message: 'This confirmation link is not valid.' }

  return (
    <div className="card">
      <h2>Email confirmation</h2>
      {shown === null ? (
        <p>Confirming your email address…</p>
      ) : (
        <>
          <p className={shown.ok ? 'notice' : 'error'} role={shown.ok ? 'status' : 'alert'}>
            {shown.message}
          </p>
          <p className="hint">
            <Link to="/login">Go to sign in</Link>
          </p>
        </>
      )}
    </div>
  )
}
