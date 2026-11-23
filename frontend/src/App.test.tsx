import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'
import { SIGNED_OUT, USER, mockApi, renderApp } from './test/utils'

const DEMO = { message: 'Hello!', server_time: '2026-11-21T18:00:00+00:00', items: [] }

describe('App', () => {
  it('redirects a signed-out visitor from / to the sign-in page', async () => {
    mockApi({ 'GET /api/auth/me': SIGNED_OUT })
    renderApp(<App />, '/')
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('shows the home page with the demo fetch to a signed-in user', async () => {
    mockApi({
      'GET /api/auth/me': { body: { user: USER } },
      'GET /api/demo': { body: DEMO },
    })
    renderApp(<App />, '/')

    expect(await screen.findByText('user@example.com')).toBeInTheDocument()
    expect(await screen.findByText('Hello!')).toBeInTheDocument()
    // One tile per app
    const tiles = screen.getByRole('navigation', { name: 'Your apps' })
    expect(tiles.querySelectorAll('a')).toHaveLength(6)
  })

  it('shows on each tile how many items the app holds', async () => {
    mockApi({
      'GET /api/auth/me': { body: { user: { ...USER, is_admin: true } } },
      'GET /api/demo': { body: DEMO },
      'GET /api/summary': {
        body: {
          drive: { folders: 3, files: 1 },
          photos: { folders: 1, files: 40 },
          tasks: { open: 5, done: 2 },
          calendar: { events: 0 },
          packages: { packages: 1 },
          recipients: { recipients: 6 },
          users: { users: 9 },
        },
      },
    })
    renderApp(<App />, '/')

    const tile = (name: RegExp) => screen.getByRole('link', { name })
    expect(await screen.findByText('3 folders · 1 document')).toBeInTheDocument()
    expect(tile(/^Drive/)).toHaveTextContent('3 folders · 1 document')
    expect(tile(/^Photos/)).toHaveTextContent('1 album · 40 photos')
    expect(tile(/^Tasks/)).toHaveTextContent('5 open · 2 done')
    expect(tile(/^Calendar/)).toHaveTextContent('0 events')
    expect(tile(/^Packages/)).toHaveTextContent('1 package')
    expect(tile(/^Recipients/)).toHaveTextContent('6 recipients')
    // Administrators also get the Users tile
    expect(tile(/^Users/)).toHaveTextContent('9 users')
  })

  it('treats an unreachable server as signed out', async () => {
    mockApi({}) // every request throws
    renderApp(<App />, '/')
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('sends unknown paths to the sign-in page when signed out', async () => {
    mockApi({ 'GET /api/auth/me': SIGNED_OUT })
    renderApp(<App />, '/no/such/page')
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('navigates between sign in and create account', async () => {
    mockApi({ 'GET /api/auth/me': SIGNED_OUT })
    renderApp(<App />, '/login')

    await userEvent.click(await screen.findByRole('link', { name: 'Create one' }))
    expect(screen.getByRole('heading', { name: 'Create account' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('link', { name: 'Sign in' }))
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('signs out and returns to the sign-in page', async () => {
    mockApi({
      'GET /api/auth/me': { body: { user: USER } },
      'GET /api/demo': { body: DEMO },
      'POST /api/auth/logout': { status: 204 },
    })
    renderApp(<App />, '/')

    await userEvent.click(await screen.findByRole('button', { name: 'Account' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })
})
