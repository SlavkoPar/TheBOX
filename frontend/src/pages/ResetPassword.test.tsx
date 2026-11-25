import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { SIGNED_OUT, lastBody, mockApi, renderApp } from '../test/utils'

const ME = { 'GET /api/auth/me': SIGNED_OUT }

describe('Forgotten password', () => {
  it('is offered on the sign-in page and asks for a link by email', async () => {
    const fetchMock = mockApi({
      ...ME,
      'POST /api/auth/forgot-password': { body: { message: 'If that address has an account, a link has been sent.' } },
    })
    renderApp(<App />, '/login')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: 'Forgot your password?' }))
    await user.type(screen.getByLabelText('Email'), 'user@example.com')
    await user.click(screen.getByRole('button', { name: 'Send the link' }))

    expect(await screen.findByRole('status')).toHaveTextContent('a link has been sent')
    expect(lastBody(fetchMock, 'POST /api/auth/forgot-password')).toEqual({ email: 'user@example.com' })
  })

  it('sets the new password with the token from the link', async () => {
    const fetchMock = mockApi({
      ...ME,
      'POST /api/auth/reset-password': { body: { message: 'Your password is changed. You can sign in now.' } },
    })
    renderApp(<App />, '/reset-password?token=abc.def')
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('New password'), 'brand new horse')
    await user.type(screen.getByLabelText('Repeat the new password'), 'brand new horse')
    await user.click(screen.getByRole('button', { name: 'Save the new password' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Your password is changed.')
    expect(lastBody(fetchMock, 'POST /api/auth/reset-password')).toEqual({
      token: 'abc.def',
      password: 'brand new horse',
    })
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login')
  })

  it('does not send passwords that differ', async () => {
    const fetchMock = mockApi(ME)
    renderApp(<App />, '/reset-password?token=abc')
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('New password'), 'brand new horse')
    await user.type(screen.getByLabelText('Repeat the new password'), 'another horse 1')
    await user.click(screen.getByRole('button', { name: 'Save the new password' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The passwords do not match.')
    expect(fetchMock).toHaveBeenCalledTimes(1) // only /auth/me
  })

  it('shows why an old link is refused and offers a new one', async () => {
    mockApi({
      ...ME,
      'POST /api/auth/reset-password': { status: 400, body: { error: 'This link has expired. Ask for a new one.' } },
    })
    renderApp(<App />, '/reset-password?token=old')
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('New password'), 'brand new horse')
    await user.type(screen.getByLabelText('Repeat the new password'), 'brand new horse')
    await user.click(screen.getByRole('button', { name: 'Save the new password' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('This link has expired.')
    expect(screen.getByRole('link', { name: 'Ask for a new link' })).toHaveAttribute('href', '/forgot-password')
  })

  it('needs a token in the link', async () => {
    mockApi(ME)
    renderApp(<App />, '/reset-password')
    expect(await screen.findByRole('alert')).toHaveTextContent('This link is not valid.')
  })
})
