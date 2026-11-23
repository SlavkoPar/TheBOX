import { Link } from 'react-router-dom'
import { appsFor } from '../apps'
import { useAuth } from '../auth'
import DemoFetch from '../components/DemoFetch'
import { Icon } from '../common/icons'

export default function Home() {
  const { user } = useAuth()

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
          <Link key={app.id} to={app.path} className={`app-tile app-${app.id}`}>
            <span className="app-icon">
              <Icon name={app.icon} size={28} />
            </span>
            <strong>{app.name}</strong>
            <small>{app.description}</small>
          </Link>
        ))}
      </nav>

      <DemoFetch />
    </div>
  )
}
