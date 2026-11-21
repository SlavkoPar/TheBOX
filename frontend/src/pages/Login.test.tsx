import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { SIGNED_OUT, USER, lastBody, mockApi, renderApp } from '../test/utils'
import Login from './Login'

function renderLogin() {
  return renderApp(
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<p>home page</p>} />
    </Routes>,
    '/login',
  )
}

async function fillAndSubmit() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Email'), 'user@example.com')
  await user.type(screen.getByLabelText('Password'), 'correct horse')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  return user
}

describe('Login', () => {
  it('signs in and goes to the home page', async () => {
    const fetchMock = mockApi({
      'GET /api/auth/me': SIGNED_OUT,
      'POST /api/auth/login': { body: { user: USER } },
    })
    renderLogin()

    await fillAndSubmit()

    expect(await screen.findByText('home page')).toBeInTheDocument()
    expect(lastBody(fetchMock, 'POST /api/auth/login')).toEqual({
      email: 'user@example.com',
      password: 'correct horse',
    })
  })

  it('shows the error for wrong credentials and stays on the page', async () => {
    mockApi({
      'GET /api/auth/me': SIGNED_OUT,
      'POST /api/auth/login': { status: 401, body: { error: 'Incorrect email or password.' } },
    })
    renderLogin()

    await fillAndSubmit()

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.')
    expect(screen.queryByRole('button', { name: /resend/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  })

  it('offers to resend the confirmation email when the account is unconfirmed', async () => {
    const fetchMock = mockApi({
      'GET /api/auth/me': SIGNED_OUT,
      'POST /api/auth/login': {
        status: 403,
        body: { error: 'Confirm your email address before signing in.', code: 'email_not_confirmed' },
      },
      'POST /api/auth/resend-confirmation': { body: { message: 'A new link has been sent.' } },
    })
    renderLogin()

    const user = await fillAndSubmit()
    await user.click(await screen.findByRole('button', { name: 'Resend confirmation email' }))

    expect(await screen.findByRole('status')).toHaveTextContent('A new link has been sent.')
    expect(lastBody(fetchMock, 'POST /api/auth/resend-confirmation')).toEqual({
      email: 'user@example.com',
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /resend/i })).not.toBeInTheDocument()
  })

  it('redirects to the home page when already signed in', async () => {
    mockApi({ 'GET /api/auth/me': { body: { user: USER } } })
    renderLogin()
    expect(await screen.findByText('home page')).toBeInTheDocument()
  })
})
