import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { AdminUser } from '../api'
import AppLayout from '../layout/AppLayout'
import { USER, mockApi, renderApp } from '../test/utils'
import Users from './Users'

const ADMIN = { ...USER, is_admin: true }

const ALL: AdminUser[] = [
  {
    id: 3,
    email: 'new@example.com',
    is_confirmed: false,
    is_admin: false,
    created_at: '2026-11-22T08:00:00+00:00',
    confirmed_at: null,
    file_count: 0,
    storage_used: 0,
  },
  {
    id: 1,
    email: 'user@example.com',
    is_confirmed: true,
    is_admin: true,
    created_at: '2026-11-01T08:00:00+00:00',
    confirmed_at: '2026-11-01T09:00:00+00:00',
    file_count: 4,
    storage_used: 2048,
  },
]

function renderUsers() {
  return renderApp(
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<p>home page</p>} />
        <Route path="/users" element={<Users />} />
      </Route>
    </Routes>,
    '/users',
  )
}

describe('Users', () => {
  it('shows an administrator everyone who registered', async () => {
    mockApi({ 'GET /api/auth/me': { body: { user: ADMIN } }, 'GET /api/admin/users': { body: { items: ALL } } })
    renderUsers()

    expect(await screen.findByText('2 registered, 1 confirmed. Newest first.')).toBeInTheDocument()
    const pending = screen.getByRole('link', { name: 'new@example.com' }).closest('tr')!
    expect(within(pending).getByText('Not confirmed')).toBeInTheDocument()

    const me = screen.getByRole('link', { name: 'user@example.com' }).closest('tr')!
    expect(within(me).getByText('Confirmed')).toBeInTheDocument()
    expect(within(me).getByText('Admin')).toBeInTheDocument()
    expect(within(me).getByText('You')).toBeInTheDocument()
    expect(within(me).getByText('2.0 KB')).toBeInTheDocument()

    // Also as cards
    await userEvent.click(screen.getByRole('button', { name: 'Grid view' }))
    const card = screen.getByRole('listitem', { name: 'user@example.com' })
    expect(within(card).getByText('4 files · 2.0 KB')).toBeInTheDocument()
  })

  it('offers Users in the apps menu to administrators only', async () => {
    mockApi({ 'GET /api/auth/me': { body: { user: ADMIN } }, 'GET /api/admin/users': { body: { items: ALL } } })
    renderUsers()

    await userEvent.click(await screen.findByRole('button', { name: 'Apps' }))
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('aria-current', 'page')
  })

  it('sends anyone else back to the home page without asking the server', async () => {
    const fetchMock = mockApi({ 'GET /api/auth/me': { body: { user: USER } } })
    renderUsers()

    expect(await screen.findByText('home page')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1) // only /auth/me
    await userEvent.click(screen.getByRole('button', { name: 'Apps' }))
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument()
  })

  it('shows the error when the list cannot be loaded', async () => {
    mockApi({
      'GET /api/auth/me': { body: { user: ADMIN } },
      'GET /api/admin/users': { status: 403, body: { error: 'Only administrators can do this.' } },
    })
    renderUsers()
    expect(await screen.findByRole('alert')).toHaveTextContent('Only administrators can do this.')
  })
})
