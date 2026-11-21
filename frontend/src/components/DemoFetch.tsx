import { useCallback, useEffect, useState } from 'react'
import { api, errorMessage } from '../api'
import type { DemoData } from '../api'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: DemoData }

/** Demo of fetching data from the backend: GET /api/demo, with loading and error states. */
export default function DemoFetch() {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    let cancelled = false
    api
      .demo()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data })
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'error', message: errorMessage(err) })
      })
    return () => {
      cancelled = true
    }
  }, [reloads])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setReloads((n) => n + 1)
  }, [])

  return (
    <div className="card">
      <h2>Demo fetch</h2>

      {state.status === 'loading' && <p>Loading…</p>}

      {state.status === 'error' && (
        <p className="error" role="alert">
          {state.message}
        </p>
      )}

      {state.status === 'ready' && (
        <>
          <p>{state.data.message}</p>
          <ul className="demo-list">
            {state.data.items.map((item) => (
              <li key={item.id}>
                <span>{item.name}</span>
                <small>{item.size}</small>
              </li>
            ))}
          </ul>
          <small>
            Server time: {new Date(state.data.server_time).toLocaleTimeString()} — from{' '}
            <code>GET /api/demo</code>
          </small>
        </>
      )}

      <button
        type="button"
        className="secondary"
        onClick={reload}
        disabled={state.status === 'loading'}
      >
        Fetch again
      </button>
    </div>
  )
}
