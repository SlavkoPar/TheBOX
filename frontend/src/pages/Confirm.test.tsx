import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SIGNED_OUT, lastBody, mockApi, renderApp } from '../test/utils'
import Confirm from './Confirm'

describe('Confirm', () => {
  it('posts the token from the URL and shows the success message', async () => {
    const fetchMock = mockApi({
      'GET /api/auth/me': SIGNED_OUT,
      'POST /api/auth/confirm': { body: { message: 'Your email address is confirmed.' } },
    })
    renderApp(<Confirm />, '/confirm?token=abc.def')

    expect(await screen.findByRole('status')).toHaveTextContent('Your email address is confirmed.')
    expect(lastBody(fetchMock, 'POST /api/auth/confirm')).toEqual({ token: 'abc.def' })
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login')
  })

  it('shows the server error for an expired token', async () => {
    mockApi({
      'GET /api/auth/me': SIGNED_OUT,
      'POST /api/auth/confirm': {
        status: 400,
        body: { error: 'This confirmation link has expired. Request a new one.' },
      },
    })
    renderApp(<Confirm />, '/confirm?token=old')

    expect(await screen.findByRole('alert')).toHaveTextContent('This confirmation link has expired.')
  })

  it('shows an error without calling the server when the token is missing', async () => {
    const fetchMock = mockApi({ 'GET /api/auth/me': SIGNED_OUT })
    renderApp(<Confirm />, '/confirm')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This confirmation link is not valid.',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1) // only the initial /me
  })
})
