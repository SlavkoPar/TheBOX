import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { FileItem, Listing } from '../api'
import Drive from '../pages/Drive'
import Photos from '../pages/Photos'
import { USER, lastBody, mockApi, renderApp } from '../test/utils'

const ME = { 'GET /api/auth/me': { body: { user: USER } } }

function file(id: number, name: string, extra: Partial<FileItem> = {}): FileItem {
  return {
    id,
    name,
    folder_id: null,
    mime_type: 'application/pdf',
    size: 2048,
    is_encrypted: false,
    created_at: '2026-11-22T08:00:00+00:00',
    updated_at: '2026-11-22T08:00:00+00:00',
    ...extra,
  }
}

const TOP: Listing = {
  folder: null,
  breadcrumbs: [],
  folders: [{ id: 3, name: 'Work', parent_id: null, created_at: '2026-11-22T08:00:00+00:00' }],
  files: [file(10, 'report.pdf'), file(11, 'plan.pdf', { is_encrypted: true })],
}

const INSIDE: Listing = {
  folder: { id: 4, name: 'Reports', parent_id: 3, created_at: '2026-11-22T08:00:00+00:00' },
  breadcrumbs: [
    { id: 3, name: 'Work' },
    { id: 4, name: 'Reports' },
  ],
  folders: [],
  files: [file(12, 'q4.pdf', { folder_id: 4 })],
}

const RECIPIENTS = [
  { id: 1, first_name: 'Ana', last_name: 'Kovač', email: 'ana@example.com', address: '', country: '', mobile: '' },
  { id: 2, first_name: 'Bo', last_name: '', email: 'bo@example.com', address: '', country: '', mobile: '' },
]

function renderDrive(route = '/drive') {
  return renderApp(
    <Routes>
      <Route path="/drive" element={<Drive />} />
      <Route path="/photos" element={<Photos />} />
      <Route path="/recipients" element={<p>recipients page</p>} />
    </Routes>,
    route,
  )
}

describe('FileBrowser (Drive)', () => {
  it('lists folders and documents', async () => {
    mockApi({ ...ME, 'GET /api/drive/items': { body: TOP } })
    renderDrive()

    expect(await screen.findByRole('link', { name: 'Work' })).toHaveAttribute('href', '/drive?folder=3')
    expect(screen.getByRole('button', { name: 'report.pdf' })).toBeInTheDocument()
    expect(screen.getByText('Encrypted')).toBeInTheDocument()
    expect(screen.getAllByText('2.0 KB')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Download report.pdf' })).toHaveAttribute(
      'href',
      '/api/drive/files/10/content?download=1',
    )
  })

  it('opens a subfolder and shows the path back', async () => {
    mockApi({
      ...ME,
      'GET /api/drive/items': { body: TOP },
      'GET /api/drive/items?folder=3': {
        body: { ...INSIDE, folder: TOP.folders[0], breadcrumbs: [{ id: 3, name: 'Work' }], files: [] },
      },
      'GET /api/drive/items?folder=4': { body: INSIDE },
    })
    renderDrive('/drive?folder=4')

    expect(await screen.findByRole('button', { name: 'q4.pdf' })).toBeInTheDocument()
    const path = screen.getByRole('navigation', { name: 'Folder path' })
    expect(within(path).getByRole('link', { name: 'Drive' })).toHaveAttribute('href', '/drive')
    expect(within(path).getByRole('heading', { name: 'Reports' })).toBeInTheDocument()

    await userEvent.click(within(path).getByRole('link', { name: 'Work' }))
    expect(await within(path).findByRole('heading', { name: 'Work' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'q4.pdf' })).not.toBeInTheDocument()
  })

  it('creates a subfolder inside the current folder', async () => {
    const fetchMock = mockApi({
      ...ME,
      'GET /api/drive/items?folder=4': { body: INSIDE },
      'POST /api/drive/folders': { status: 201, body: { id: 9, name: '2026', parent_id: 4 } },
    })
    renderDrive('/drive?folder=4')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'New folder' }))
    const dialog = screen.getByRole('dialog', { name: 'New folder' })
    await user.type(within(dialog).getByLabelText('Name'), '2026')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    expect(lastBody(fetchMock, 'POST /api/drive/folders')).toEqual({ name: '2026', parent_id: 4 })
  })

  it('uploads the chosen files into the current folder', async () => {
    const fetchMock = mockApi({
      ...ME,
      'GET /api/drive/items?folder=4': { body: INSIDE },
      'POST /api/drive/files': { status: 201, body: { files: [] } },
    })
    renderDrive('/drive?folder=4')

    const input = await screen.findByLabelText('Upload documents')
    await userEvent.upload(input, [
      new File(['a'], 'a.txt', { type: 'text/plain' }),
      new File(['b'], 'b.txt', { type: 'text/plain' }),
    ])

    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    const form = call[1]!.body as FormData
    expect(form.getAll('file').map((f) => (f as File).name)).toEqual(['a.txt', 'b.txt'])
    expect(form.get('folder_id')).toBe('4')
  })

  it('shares the selected documents with the selected recipients', async () => {
    const fetchMock = mockApi({
      ...ME,
      'GET /api/drive/items': { body: TOP },
      'GET /api/recipients': { body: { items: RECIPIENTS } },
      'POST /api/drive/shares': {
        status: 201,
        body: { link: 'http://localhost/shared/tok', sent: ['ana@example.com'], failed: [] },
      },
    })
    renderDrive()
    const user = userEvent.setup()

    const share = await screen.findByRole('button', { name: 'Share' })
    expect(share).toBeDisabled() // nothing selected yet

    await user.click(screen.getByRole('checkbox', { name: 'Select report.pdf' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select plan.pdf' }))
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    await user.click(share)

    const dialog = screen.getByRole('dialog', { name: 'Share 2 documents' })
    await user.click(await within(dialog).findByRole('checkbox', { name: /Ana Kovač/ }))
    await user.type(within(dialog).getByLabelText('Message (optional)'), 'For Monday')
    await user.click(within(dialog).getByRole('button', { name: 'Send link' }))

    expect(await within(dialog).findByRole('status')).toHaveTextContent('ana@example.com')
    expect(within(dialog).getByLabelText('Link')).toHaveValue('http://localhost/shared/tok')
    // One of the shared documents is encrypted: remind the sender about the password
    expect(within(dialog).getByText(/Encrypted documents open only with their password/)).toBeInTheDocument()
    expect(lastBody(fetchMock, 'POST /api/drive/shares')).toEqual({
      file_ids: [10, 11],
      recipient_ids: [1],
      message: 'For Monday',
    })
  })

  it('requires a recipient and reports addresses the email could not reach', async () => {
    mockApi({
      ...ME,
      'GET /api/drive/items': { body: TOP },
      'GET /api/recipients': { body: { items: RECIPIENTS } },
      'POST /api/drive/shares': {
        status: 201,
        body: { link: 'http://localhost/shared/tok', sent: ['ana@example.com'], failed: ['bo@example.com'] },
      },
    })
    renderDrive()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('checkbox', { name: 'Select all' }))
    await user.click(screen.getByRole('button', { name: 'Share' }))
    const dialog = screen.getByRole('dialog')
    await within(dialog).findByRole('checkbox', { name: /Ana Kovač/ })

    await user.click(within(dialog).getByRole('button', { name: 'Send link' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Select at least one recipient.')

    await user.click(within(dialog).getByRole('checkbox', { name: 'Everyone' }))
    await user.click(within(dialog).getByRole('button', { name: 'Send link' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('bo@example.com')
  })

  it('points to Recipients when there is nobody to share with', async () => {
    mockApi({
      ...ME,
      'GET /api/drive/items': { body: TOP },
      'GET /api/recipients': { body: { items: [] } },
    })
    renderDrive()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('checkbox', { name: 'Select report.pdf' }))
    await user.click(screen.getByRole('button', { name: 'Share' }))
    const dialog = screen.getByRole('dialog')

    expect(await within(dialog).findByText(/You have no recipients yet/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Send link' })).toBeDisabled()
    await user.click(within(dialog).getByRole('link', { name: 'Add recipients' }))
    expect(screen.getByText('recipients page')).toBeInTheDocument()
  })

  it('encrypts a document with a password', async () => {
    const fetchMock = mockApi({
      ...ME,
      'GET /api/drive/items': { body: TOP },
      'POST /api/drive/files/10/encrypt': { body: file(10, 'report.pdf', { is_encrypted: true }) },
    })
    renderDrive()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Encrypt report.pdf' }))
    const dialog = screen.getByRole('dialog', { name: 'Encrypt report.pdf' })
    expect(within(dialog).getByText(/cannot be recovered/)).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Password'), 'open sesame')
    await user.click(within(dialog).getByRole('button', { name: 'Encrypt' }))

    expect(lastBody(fetchMock, 'POST /api/drive/files/10/encrypt')).toEqual({ password: 'open sesame' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('decrypts with the password and shows a wrong-password error', async () => {
    let attempts = 0
    const fetchMock = mockApi({
      ...ME,
      'GET /api/drive/items': { body: TOP },
      'POST /api/drive/files/11/decrypt': () =>
        ++attempts === 1
          ? { status: 403, body: { error: 'Incorrect password.', code: 'wrong_password' } }
          : { body: file(11, 'plan.pdf') },
    })
    renderDrive()
    const user = userEvent.setup()

    // An encrypted document offers Decrypt, not Encrypt
    expect(await screen.findByRole('button', { name: 'Decrypt plan.pdf' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Encrypt plan.pdf' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Decrypt plan.pdf' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Password'), 'wrong one')
    await user.click(within(dialog).getByRole('button', { name: 'Decrypt' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Incorrect password.')

    await user.clear(within(dialog).getByLabelText('Password'))
    await user.type(within(dialog).getByLabelText('Password'), 'open sesame')
    await user.click(within(dialog).getByRole('button', { name: 'Decrypt' }))
    expect(lastBody(fetchMock, 'POST /api/drive/files/11/decrypt')).toEqual({ password: 'open sesame' })
  })

  it('deletes the selected documents after confirmation', async () => {
    const fetchMock = mockApi({
      ...ME,
      'GET /api/drive/items': { body: TOP },
      'DELETE /api/drive/files/10': { status: 204 },
      'DELETE /api/drive/files/11': { status: 204 },
    })
    renderDrive()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('checkbox', { name: 'Select all' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete 2 documents' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    const deleted = fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'DELETE')
      .map(([url]) => String(url))
    expect(deleted).toEqual(['/api/drive/files/10', '/api/drive/files/11'])
  })
})

describe('FileBrowser (Photos)', () => {
  const PHOTOS: Listing = {
    folder: null,
    breadcrumbs: [],
    folders: [{ id: 5, name: 'Holiday', parent_id: null, created_at: '2026-11-22T08:00:00+00:00' }],
    files: [file(20, 'beach.jpg', { mime_type: 'image/jpeg' })],
  }

  it('shows albums and thumbnails, with sharing but without encryption', async () => {
    const fetchMock = mockApi({
      ...ME,
      'GET /api/photos/items': { body: PHOTOS },
      'GET /api/recipients': { body: { items: RECIPIENTS } },
      'POST /api/photos/shares': {
        status: 201,
        body: { link: 'http://localhost/shared/tok', sent: ['bo@example.com'], failed: [] },
      },
    })
    renderDrive('/photos')
    const user = userEvent.setup()

    expect(await screen.findByRole('img', { name: 'beach.jpg' })).toHaveAttribute(
      'src',
      '/api/photos/files/20/content',
    )
    expect(screen.getByRole('link', { name: 'Holiday' })).toHaveAttribute('href', '/photos?folder=5')
    expect(screen.getByRole('button', { name: 'New album' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Encrypt/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New document' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Upload photos')).toHaveAttribute('accept', 'image/*')

    await user.click(screen.getByRole('checkbox', { name: 'Select beach.jpg' }))
    await user.click(screen.getByRole('button', { name: 'Share' }))
    const dialog = screen.getByRole('dialog', { name: 'Share 1 photo' })
    await user.click(await within(dialog).findByRole('checkbox', { name: /Bo/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Send link' }))

    expect(await within(dialog).findByRole('status')).toHaveTextContent('bo@example.com')
    expect(lastBody(fetchMock, 'POST /api/photos/shares')).toEqual({
      file_ids: [20],
      recipient_ids: [2],
      message: '',
    })
  })

  it('opens a photo in a larger view with a download link', async () => {
    mockApi({ ...ME, 'GET /api/photos/items': { body: PHOTOS } })
    renderDrive('/photos')

    await userEvent.click(await screen.findByRole('img', { name: 'beach.jpg' }))
    const dialog = screen.getByRole('dialog', { name: 'beach.jpg' })
    expect(within(dialog).getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      '/api/photos/files/20/content?download=1',
    )
  })
})
