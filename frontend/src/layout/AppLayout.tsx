import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { errorMessage } from '../api'
import { appForPath, appsFor } from '../apps'
import { useAuth } from '../auth'
import { Icon } from '../common/icons'
import type { IconName } from '../common/icons'
import { MessengerContext, useMessenger } from '../common/messengerContext'
import MessengerPanel from './MessengerPanel'

type MenuProps = {
  label: string
  icon: IconName
  children: (close: () => void) => ReactNode
}

/** Round icon button in the header that opens a panel below it. */
function HeaderMenu({ label, icon, children }: MenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    function onPointer(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="header-menu" ref={ref}>
      <button
        type="button"
        className="icon-button"
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={icon} size={22} />
      </button>
      {open && (
        <div className="header-panel" id={panelId}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

function AppsMenu() {
  const { pathname } = useLocation()
  const { user } = useAuth()
  const messenger = useMessenger()
  const current = appForPath(pathname)

  return (
    <HeaderMenu label="Apps" icon="grid">
      {(close) => (
        <nav className="apps-grid" aria-label="Apps">
          {appsFor(user).map((app) => (
            <Link
              key={app.id}
              to={app.path}
              className={`app-link app-${app.id}`}
              aria-current={current?.id === app.id ? 'page' : undefined}
              onClick={(event) => {
                close()
                // The Messenger opens as a panel over the page you are on
                if (app.id === 'messenger') {
                  event.preventDefault()
                  messenger.open()
                }
              }}
            >
              <span className="app-icon">
                <Icon name={app.icon} size={24} />
              </span>
              {app.name}
            </Link>
          ))}
        </nav>
      )}
    </HeaderMenu>
  )
}

function ProfileMenu() {
  const { user, logout } = useAuth()
  const [error, setError] = useState('')

  async function signOut() {
    setError('')
    try {
      await logout()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <HeaderMenu label="Account" icon="user">
      {() => (
        <div className="profile-panel">
          <p className="hint">Signed in as</p>
          <p className="profile-email">{user?.email}</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="secondary" onClick={signOut}>
            Sign out
          </button>
        </div>
      )}
    </HeaderMenu>
  )
}

/** Header (brand, apps menu, profile) around the page of the current app. */
export default function AppLayout() {
  const { pathname } = useLocation()
  const current = appForPath(pathname)
  const [chat, setChat] = useState({ open: false, peer: '' })

  const openChat = useCallback(
    // Without an address the panel opens where it was left
    (email?: string) => setChat((was) => ({ open: true, peer: email ?? was.peer })),
    [],
  )
  const closeChat = useCallback(() => setChat((was) => ({ ...was, open: false })), [])
  const messenger = useMemo(() => ({ open: openChat, close: closeChat }), [openChat, closeChat])

  return (
    <MessengerContext.Provider value={messenger}>
    <div className="shell">
      <header className="shell-header">
        <Link to="/" className="brand">
          TheBOX
        </Link>
        {current && (
          <span className={`current-app app-${current.id}`}>
            <span className="app-icon">
              <Icon name={current.icon} size={18} />
            </span>
            {current.name}
          </span>
        )}
        <span className="spacer" />
        <MessengerPanel open={chat.open} peer={chat.peer} onOpen={openChat} onClose={closeChat} />
        <AppsMenu />
        <ProfileMenu />
      </header>
      <main className="shell-main">
        <Outlet />
      </main>
    </div>
    </MessengerContext.Provider>
  )
}
