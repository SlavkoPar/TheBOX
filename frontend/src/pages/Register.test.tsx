import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { SIGNED_OUT, lastBody, mockApi, renderApp } from '../test/utils'
import Register from './Register'

async function fillAndSubmit(password: string, repeat: string) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Email'), 'new@example.com')
  await user.type(screen.getByLabelText(/^Password/), password)
  await user.type(screen.getByLabelText('Repeat password'), repeat)
  await user.click(screen.getByRole('button', { name: 'Create account' }))
}

describe('Register', () => {
  it('registers and tells the user to check their inbox', async () => {
    const fetchMock = mockApi({
      'GET /api/auth/me': SIGNED_OUT,
      'POST /api/auth/register': { status: 201, body: { message: 'Check your inbox.' } },
    })
    renderApp(<Register />, '/register')

    await fillAndSubmit('correct horse', 'correct horse')

    expect(await screen.findByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument()
    expect(screen.getByText('new@example.com')).toBeInTheDocument()
    expect(lastBody(fetchMock, 'POST /api/auth/register')).toEqual({
      email: 'new@example.com',
      password: 'correct horse',
    })
  })

  it('does not call the server when the passwords differ', async () => {
    const fetchMock = mockApi({ 'GET /api/auth/me': SIGNED_OUT })
    renderApp(<Register />, '/register')

    await fillAndSubmit('correct horse', 'correct house')

    expect(await screen.findByRole('alert')).toHaveTextContent('The passwords do not match.')
    expect(fetchMock).toHaveBeenCalledTimes(1) // only the initial /me
  })

  it('shows the server error and keeps the form', async () => {
    mockApi({
      'GET /api/auth/me': SIGNED_OUT,
      'POST /api/auth/register': {
        status: 502,
        body: { error: 'The confirmation email could not be sent.' },
      },
    })
    renderApp(<Register />, '/register')

    await fillAndSubmit('correct horse', 'correct horse')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The confirmation email could not be sent.',
    )
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled()
  })
})
