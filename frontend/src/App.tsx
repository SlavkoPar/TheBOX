import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import './App.css'
import { useAuth } from './auth'
import AppLayout from './layout/AppLayout'
import Calendar from './pages/Calendar'
import Confirm from './pages/Confirm'
import Drive from './pages/Drive'
import ForgotPassword from './pages/ForgotPassword'
import Home from './pages/Home'
import Login from './pages/Login'
import Messenger from './pages/Messenger'
import Packages from './pages/Packages'
import Photos from './pages/Photos'
import Friends from './pages/Friends'
import Register from './pages/Register'
import ResetPassword from './pages/ResetPassword'
import Shared from './pages/Shared'
import Tasks from './pages/Tasks'
import Users from './pages/Users'

/** Signed-in area: redirects to the sign-in page when there is no user. */
function RequireAuth() {
  const { user, loading } = useAuth()
  if (loading) return <p className="page-loading">Loading…</p>
  return user ? <AppLayout /> : <Navigate to="/login" replace />
}

/** Sign-in, registration and confirmation pages. */
function AuthPages() {
  const { loading } = useAuth()
  return (
    <main className="auth-pages">
      <h1>TheBOX</h1>
      {loading ? <p>Loading…</p> : <Outlet />}
    </main>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<AuthPages />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/confirm" element={<Confirm />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
      </Route>

      {/* Public page for people who received a link by email */}
      <Route path="/shared/:token" element={<Shared />} />

      <Route element={<RequireAuth />}>
        <Route path="/" element={<Home />} />
        <Route path="/drive" element={<Drive />} />
        <Route path="/photos" element={<Photos />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/packages" element={<Packages />} />
        <Route path="/friends" element={<Friends />} />
        <Route path="/messenger" element={<Messenger />} />
        <Route path="/users" element={<Users />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
