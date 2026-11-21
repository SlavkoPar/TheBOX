import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { AuthProvider } from '../auth'

type Reply = { status?: number; body?: unknown }
type Handler = Reply | ((body: unknown) => Reply)

/**
 * Replace global fetch with a fake backend. Keys are "METHOD /api/path".
 * A request with no matching key fails the test.
 */
export function mockApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`
    const handler = routes[key]
    if (!handler) throw new Error(`Unexpected request: ${key}`)

    const sent = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    const { status = 200, body } = typeof handler === 'function' ? handler(sent) : handler
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Body of the most recent call to the given "METHOD /api/path". */
export function lastBody(fetchMock: ReturnType<typeof mockApi>, key: string): unknown {
  const call = fetchMock.mock.calls
    .filter(([input, init]) => `${init?.method ?? 'GET'} ${String(input)}` === key)
    .at(-1)
  if (!call) throw new Error(`No request made to ${key}`)
  return JSON.parse(String(call[1]?.body))
}

export const SIGNED_OUT: Reply = { status: 401, body: { error: 'Authentication required.' } }

export const USER = { id: 1, email: 'user@example.com', is_confirmed: true }

/** Render inside the router and AuthProvider, starting at the given URL. */
export function renderApp(ui: ReactNode, route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>,
  )
}
