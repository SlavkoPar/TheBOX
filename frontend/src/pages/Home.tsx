import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { summaryApi } from '../api'
import type { Summary } from '../api'
import { appsFor, countsFor } from '../apps'
import { useAuth } from '../auth'
import DemoFetch from '../components/DemoFetch'
import { Icon } from '../common/icons'
import { useMessenger } from '../common/messengerContext'

export default function Home() {
  const { user } = useAuth()
  const messenger = useMessenger()
  const [summary, setSummary] = useState<Summary | null>(null)

  useEffect(() => {
    let cancelled = false
    // The counts are a nicety: if they cannot be loaded, the tiles work without them.
    summaryApi.get().then(
      (data) => {
        if (!cancelled) setSummary(data)
      },
      () => undefined,
    )
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Welcome</h2>
          <p className="hint">
            Signed in as <strong>{user?.email}</strong>.
          </p>
        </div>
      </div>

      <nav className="app-tiles" aria-label="Your apps">
        {appsFor(user).map((app) => (
          <Link
            key={app.id}
            to={app.path}
            className={`app-tile app-${app.id}`}
            onClick={(event) => {
              // The Messenger opens as a panel on the right, not as a page
              if (app.id === 'messenger') {
                event.preventDefault()
                messenger.open()
              }
            }}
          >
            <span className="app-icon">
              <Icon name={app.icon} size={28} />
            </span>
            <strong>{app.name}</strong>
            <small>{app.description}</small>
            {countsFor(app.id, summary) && <span className="app-counts">{countsFor(app.id, summary)}</span>}
          </Link>
        ))}
      </nav>

      {/* A check that the frontend reaches the backend: of use to administrators only */}
      {user?.is_admin && <DemoFetch />}
    </div>
  )
}
