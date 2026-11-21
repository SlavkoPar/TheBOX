import { describe, expect, it, vi } from 'vitest'
import { ApiError, api, errorMessage } from './api'
import { lastBody, mockApi } from './test/utils'

describe('api', () => {
  it('sends JSON and returns the parsed response', async () => {
    const fetchMock = mockApi({
      'POST /api/auth/login': { body: { user: { id: 1, email: 'a@b.co', is_confirmed: true } } },
    })

    const data = await api.login('a@b.co', 'password1')

    expect(data.user.email).toBe('a@b.co')
    expect(lastBody(fetchMock, 'POST /api/auth/login')).toEqual({
      email: 'a@b.co',
      password: 'password1',
    })
    const init = fetchMock.mock.calls[0][1]
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(init?.credentials).toBe('same-origin')
  })

  it('sends no body or content type on GET', async () => {
    const fetchMock = mockApi({ 'GET /api/demo': { body: { message: 'hi', items: [] } } })
    await api.demo()
    const init = fetchMock.mock.calls[0][1]
    expect(init?.body).toBeUndefined()
    expect(init?.headers).toBeUndefined()
  })

  it('returns null for 204 responses', async () => {
    mockApi({ 'POST /api/auth/logout': { status: 204 } })
    await expect(api.logout()).resolves.toBeNull()
  })

  it('throws ApiError with the server message, status and code', async () => {
    mockApi({
      'POST /api/auth/login': {
        status: 403,
        body: { error: 'Confirm your email address before signing in.', code: 'email_not_confirmed' },
      },
    })

    const err = await api.login('a@b.co', 'password1').catch((e) => e)

    expect(err).toBeInstanceOf(ApiError)
    expect(err.message).toBe('Confirm your email address before signing in.')
    expect(err.status).toBe(403)
    expect(err.code).toBe('email_not_confirmed')
  })

  it('falls back to a generic message when the error body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502 })),
    )
    const err = await api.me().catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.message).toBe('Request failed (502).')
    expect(err.status).toBe(502)
  })

  it('reports network failures as an ApiError with status 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    const err = await api.me().catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(0)
    expect(err.message).toMatch(/cannot reach the server/i)
  })
})

describe('errorMessage', () => {
  it('uses the message of an Error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
  })

  it('falls back for non-errors', () => {
    expect(errorMessage('nope')).toBe('Something went wrong.')
  })
})
