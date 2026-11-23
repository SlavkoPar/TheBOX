import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { SharedListing } from '../api'
import { mockApi } from '../test/utils'
import Shared from './Shared'

const NO_SIZE = { width: null, height: null }

const DOCS: SharedListing = {
  app: 'drive',
  shared_by: 'user@example.com',
  message: 'For the meeting.',
  expires_at: '2026-12-22T08:00:00+00:00',
  files: [
    { id: 10, name: 'report.pdf', mime_type: 'application/pdf', size: 2048, is_encrypted: false, ...NO_SIZE },
    { id: 11, name: 'data.zip', mime_type: 'application/zip', size: 5000, is_encrypted: false, ...NO_SIZE },
    { id: 12, name: 'plan.txt', mime_type: 'text/plain', size: 15, is_encrypted: true, ...NO_SIZE },
  ],
}

// The page is public: rendered without AuthProvider, and it must not ask who is signed in.
function renderShared(token = 'tok') {
  return render(
    <MemoryRouter initialEntries={[`/shared/${token}`]}>
      <Routes>
        <Route path="/shared/:token" element={<Shared />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Shared', () => {
  it('lists the shared documents with view and download links, without signing in', async () => {
    const fetchMock = mockApi({ 'GET /api/shared/tok': { body: DOCS } })
    renderShared()

    expect(await screen.findByRole('heading', { name: '3 documents shared with you' })).toBeInTheDocument()
    expect(screen.getByText(/From user@example.com/)).toBeInTheDocument()
    expect(screen.getByText('For the meeting.')).toBeInTheDocument()

    expect(screen.getByRole('link', { name: 'View report.pdf' })).toHaveAttribute(
      'href',
      '/api/shared/tok/files/10',
    )
    expect(screen.getByRole('link', { name: 'Download report.pdf' })).toHaveAttribute(
      'href',
      '/api/shared/tok/files/10?download=1',
    )
    // A type the browser must not display is download-only
    expect(screen.queryByRole('link', { name: 'View data.zip' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download data.zip' })).toBeInTheDocument()

    expect(fetchMock).toHaveBeenCalledTimes(1) // no /auth/me
  })

  it('asks for the password of an encrypted document and downloads the decrypted copy', async () => {
    let attempts = 0
    const fetchMock = mockApi({
      'GET /api/shared/tok': { body: DOCS },
      'POST /api/shared/tok/files/12': () =>
        ++attempts === 1
          ? { status: 403, body: { error: 'Incorrect password.', code: 'wrong_password' } }
          : { body: 'top secret plan' },
    })
    const createObjectURL = vi.fn(() => 'blob:fake')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }))
    renderShared()
    const user = userEvent.setup()

    const row = (await screen.findByText('plan.txt')).closest('li')!
    expect(within(row).queryByRole('link')).not.toBeInTheDocument() // no direct link
    await user.click(within(row).getByRole('button', { name: 'Unlock and download' }))

    const dialog = screen.getByRole('dialog', { name: 'Unlock plan.txt' })
    await user.type(within(dialog).getByLabelText('Password'), 'wrong one')
    await user.click(within(dialog).getByRole('button', { name: 'Download' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Incorrect password.')
    expect(createObjectURL).not.toHaveBeenCalled()

    await user.clear(within(dialog).getByLabelText('Password'))
    await user.type(within(dialog).getByLabelText('Password'), 'open sesame')
    await user.click(within(dialog).getByRole('button', { name: 'Download' }))

    await vi.waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1))
    const post = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').at(-1)!
    expect(JSON.parse(String(post[1]!.body))).toEqual({ password: 'open sesame' })
  })

  it('shows shared photos as a gallery', async () => {
    mockApi({
      'GET /api/shared/tok': {
        body: {
          ...DOCS,
          app: 'photos',
          message: '',
          files: [
            { id: 20, name: 'beach.jpg', mime_type: 'image/jpeg', size: 9000, is_encrypted: false, width: 800, height: 600 },
          ],
        },
      },
    })
    renderShared()

    expect(await screen.findByRole('heading', { name: '1 photo shared with you' })).toBeInTheDocument()
    // Small version in the gallery; the link opens the full photo
    const image = screen.getByRole('img', { name: 'beach.jpg' })
    expect(image).toHaveAttribute('src', '/api/shared/tok/files/20/thumb')
    expect(image.closest('a')).toHaveAttribute('href', '/api/shared/tok/files/20')
    expect(screen.getByRole('link', { name: 'Download beach.jpg' })).toHaveAttribute(
      'href',
      '/api/shared/tok/files/20?download=1',
    )
  })

  it('shows a package by its name, with the folder each file is in', async () => {
    mockApi({
      'GET /api/shared/tok': {
        body: {
          ...DOCS,
          app: 'package',
          name: 'For the board',
          files: [
            { id: 30, name: 'top.txt', path: '', mime_type: 'text/plain', size: 15, is_encrypted: false, ...NO_SIZE },
            { id: 31, name: 'cat.png', path: 'Trip / Day 1', mime_type: 'image/png', size: 2048, is_encrypted: false, ...NO_SIZE },
          ],
        },
      },
    })
    renderShared()

    expect(await screen.findByRole('heading', { name: 'For the board' })).toBeInTheDocument()
    expect(screen.getByText(/2 files · From user@example.com/)).toBeInTheDocument()

    const rows = within(screen.getByRole('list', { name: 'Shared files' })).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('top.txt15 B')
    expect(rows[1]).toHaveTextContent('cat.pngTrip / Day 1 · 2.0 KB')
    expect(screen.getByRole('link', { name: 'Download cat.png' })).toHaveAttribute(
      'href',
      '/api/shared/tok/files/31?download=1',
    )
  })

  it('explains when the link is invalid or expired', async () => {
    mockApi({
      'GET /api/shared/bad': { status: 404, body: { error: 'This link is not valid or has expired.' } },
    })
    renderShared('bad')

    expect(await screen.findByRole('heading', { name: 'Link not available' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('not valid or has expired')
  })
})
