import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { FileItem, Folder, Listing } from '../api'
import Drive from '../pages/Drive'
import Photos from '../pages/Photos'
import { USER, lastBody, mockApi, renderApp } from '../test/utils'

const ME = { 'GET /api/auth/me': { body: { user: USER } } }
const WHEN = '2026-11-22T08:00:00+00:00'

function file(id: number, name: string, extra: Partial<FileItem> = {}): FileItem {
  return {
    id,
    name,
    folder_id: null,
    mime_type: 'application/pdf',
    size: 2048,
    is_encrypted: false,
    created_at: WHEN,
    updated_at: WHEN,
    deleted_at: null,
    width: null,
    height: null,
    taken_at: null,
    camera: null,
    ...extra,
  }
}

function folder(id: number, name: string, parent_id: number | null = null, extra: Partial<Folder> = {}): Folder {
  return { id, name, parent_id, created_at: WHEN, deleted_at: null, ...extra }
}

const TOP: Listing = {
  folder: null,
  breadcrumbs: [],
  folders: [folder(3, 'Work')],
  files: [file(10, 'report.pdf'), file(11, 'plan.pdf', { is_encrypted: true })],
}

const INSIDE: Listing = {
  folder: folder(4, 'Reports', 3),
  breadcrumbs: [
    { id: 3, name: 'Work' },
    { id: 4, name: 'Reports' },
  ],
  folders: [],
  files: [file(12, 'q4.pdf', { folder_id: 4 })],
}

const FRIENDS = [
  { id: 1, first_name: 'Ana', last_name: 'Kovač', email: 'ana@example.com', address: '', country: '', mobile: '' },
  { id: 2, first_name: 'Bo', last_name: '', email: 'bo@example.com', address: '', country: '', mobile: '' },
]

function renderFiles(route = '/drive') {
  return renderApp(
    <Routes>
      <Route path="/drive" element={<Drive />} />
      <Route path="/photos" element={<Photos />} />
      <Route path="/friends" element={<p>friends page</p>} />
    </Routes>,
    route,
  )
}

function calls(fetchMock: ReturnType<typeof mockApi>, method: string) {
  return fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === method).map(([url]) => String(url))
}

describe('FileBrowser (Drive): browsing', () => {
  it('lists folders and documents', async () => {
    mockApi({ ...ME, 'GET /api/drive/items': { body: TOP } })
    renderFiles()

    expect(await screen.findByRole('link', { name: 'Work' })).toHaveAttribute('href', '/drive?folder=3')
    expect(screen.getByRole('button', { name: 'report.pdf' })).toBeInTheDocument()
    expect(screen.getByText('Encrypted')).toBeInTheDocument()
    expect(screen.getAllByText('2.0 KB')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Download report.pdf' })).toHaveAttribute(
      'href',
      '/api/drive/files/10/content?download=1',
    )
  })

  it('switches to a grid of tiles and remembers the choice', async () => {
    mockApi({ ...ME, 'GET /api/drive/items': { body: TOP } })
    const first = renderFiles()
    const user = userEvent.setup()

    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Grid view' }))

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    const tiles = within(screen.getByRole('list', { name: 'documents' })).getAllByRole('listitem')
    expect(tiles).toHaveLength(2)
    // Same things can be done from a tile as from a row
    expect(within(tiles[0]).getByRole('button', { name: 'report.pdf' })).toBeInTheDocument()
    expect(within(tiles[0]).getByRole('checkbox', { name: 'Select report.pdf' })).toBeInTheDocument()
    expect(within(tiles[0]).getByRole('link', { name: 'Download report.pdf' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Work' })).toHaveAttribute('href', '/drive?folder=3')

    // Coming back later, Drive is still a grid
    first.unmount()
    renderFiles()
    expect(await screen.findByRole('list', { name: 'documents' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Grid view' })).toHaveAttribute('aria-pressed', 'true')
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
    renderFiles('/drive?folder=4')

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
      'POST /api/drive/folders': { status: 201, body: folder(9, '2026', 4) },
    })
    renderFiles('/drive?folder=4')
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
    renderFiles('/drive?folder=4')

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

  it('shows how much storage is used', async () => {
    mockApi({
      ...ME,
      'GET /api/drive/items': { body: TOP },
      'GET /api/storage': { body: { used: 5 * 1024 * 1024, quota: 500 * 1024 * 1024 } },
    })
    renderFiles()
    expect(await screen.findByText('5.0 MB of 500 MB used')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Storage used' })).toHaveAttribute('max', String(500 * 1024 * 1024))
  })

  it('creates a new document of the chosen type', async () => {
    const fetchMock = mockApi({
      ...ME,
      'GET /api/drive/items': { body: TOP },
      'POST /api/drive/files': { status: 201, body: { files: [] } },
    })
    renderFiles()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'New document' }))
    const dialog = screen.getByRole('dialog', { name: 'New document' })
    await user.clear(within(dialog).getByLabelText('Name'))
    await user.type(within(dialog).getByLabelText('Name'), 'Budget')
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'Spreadsheet (.csv)')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    const created = (call[1]!.body as FormData).get('file') as File
    expect(created.name).toBe('Budget.csv')
    expect(created.type).toBe('text/csv')
  })
})

describe('FileBrowser (Drive): sharing', () => {
  it('shares the selected documents with the selected friends', async () => {
    const fetchMock = mockApi({
      ...ME,
      'GET /api/drive/items': { body: TOP },
      'GET /api/friends': { body: { items: FRIENDS } },
      'POST /api/packages': { status: 201, body: { id: 7 } },
      'POST /api/packages/7/send': {
        body: { link: 'http://localhost/shared/tok', sent: ['ana@example.com'], failed: [] },
      },
    })
    renderFiles()
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
    // What is shared is saved as a package, then sent
    expect(within(dialog).getByRole('link', { name: 'Packages' })).toHaveAttribute('href', '/packages')
    expect(lastBody(fetchMock, 'POST /api/packages')).toEqual({
      name: 'report.pdf and 1 more',
      message: 'For Monday',
      file_ids: [10, 11],
      folder_ids: [],
      friend_ids: [1],
    })
    expect(calls(fetchMock, 'POST')).toEqual(['/api/packages', '/api/packages/7/send'])
  })

  it('shares a whole folder', async () => {
    const fetchMock = mockApi({
      ...ME,
      'GET /api/drive/items': { body: TOP },
      'GET /api/friends': { body: { items: FRIENDS } },
      'POST /api/packages': { status: 201, body: { id: 7 } },
      'POST /api/packages/7/send': {
        body: { link: 'http://localhost/shared/tok', sent: ['bo@example.com'], failed: [] },
      },
    })
    renderFiles()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('checkbox', { name: 'Select folder Work' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select report.pdf' }))
    await user.click(screen.getByRole('button', { name: 'Share' }))

    const dialog = screen.getByRole('dialog', { name: 'Share 1 folder and 1 document' })
    expect(within(dialog).getByText(/everything in this folder/)).toBeInTheDocument()
    expect(within(dialog).getByText(/including what is added later/)).toBeInTheDocument()
    await user.clear(within(dialog).getByLabelText('Package name'))
    await user.type(within(dialog).getByLabelText('Package name'), 'Work files')
    await user.click(await within(dialog).findByRole('checkbox', { name: /Bo/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Send link' }))

    await within(dialog).findByRole('status')
    expect(lastBody(fetchMock, 'POST /api/packages')).toEqual({
      name: 'Work files',
      message: '',
      file_ids: [10],
      folder_ids: [3],
      friend_ids: [2],
    })
  })

  it('requires a friend and reports addresses the email could not reach', async () => {
    mockApi({
      ...ME,
      'GET /api/drive/items': { body: TOP },
      'GET /api/friends': { body: { items: FRIENDS } },
      'POST /api/packages': { status: 201, body: { id: 7 } },
      'POST /api/packages/7/send': {
        body: { link: 'http://localhost/shared/tok', sent: ['ana@example.com'], failed: ['bo@example.com'] },
      },
    })
    renderFiles()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('checkbox', { name: 'Select all' }))
    await user.click(screen.getByRole('button', { name: 'Share' }))
    const dialog = screen.getByRole('dialog')
    await within(dialog).findByRole('checkbox', { name: /Ana Kovač/ })

    await user.click(within(dialog).getByRole('button', { name: 'Send link' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Select at least one friend.')

    await user.click(within(dialog).getByRole('checkbox', { name: 'Everyone' }))
    await user.click(within(dialog).getByRole('button', { name: 'Send link' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('bo@example.com')
  })

  it('points to Friends when there is nobody to share with', async () => {
    mockApi({
      ...ME,
      'GET /api/drive/items': { body: TOP },
      'GET /api/friends': { body: { items: [] } },
    })
    renderFiles()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('checkbox', { name: 'Select report.pdf' }))
    await user.click(screen.getByRole('button', { name: 'Share' }))
    const dialog = screen.getByRole('dialog')

    expect(await within(dialog).findByText(/You have no friends yet/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Send link' })).toBeDisabled()
    await user.click(within(dialog).getByRole('link', { name: 'Add friends' }))
    expect(screen.getByText('friends page')).toBeInTheDocument()
  })

  it('lists shared links and revokes one after confirmation', async () => {
    const link = {
      id: 5,
      link: 'http://localhost/shared/tok',
      message: '',
      created_at: WHEN,
      expires_at: '2026-12-22T08:00:00+00:00',
      expired: false,
      files: [file(10, 'report.pdf')],
      friends: [FRIENDS[0]],
    }
    const fetchMock = mockApi({
      ...ME,
      'GET /api/drive/items': { body: TOP },
      'GET /api/drive/shares': { body: { items: [link, { ...link, id: 6, expired: true, files: [] }] } },
      'DELETE /api/drive/shares/5': { status: 204 },
    })
    renderFiles()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Shared links' }))
    const dialog = screen.getByRole('dialog', { name: 'Shared links' })
    const rows = await within(dialog).findAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('report.pdf')).toBeInTheDocument()
    expect(within(rows[0]).getByText(/To ana@example.com/)).toBeInTheDocument()
    expect(within(rows[0]).getByRole('textbox')).toHaveValue('http://localhost/shared/tok')
    expect(within(rows[1]).getByText('Expired')).toBeInTheDocument()
    expect(within(rows[1]).getByText('No documents left')).toBeInTheDocument()

    await user.click(within(rows[0]).getByRole('button', { name: 'Revoke' }))
    expect(calls(fetchMock, 'DELETE')).toEqual([]) // asks first
    await user.click(within(rows[0]).getByRole('button', { name: 'Stop sharing' }))

    await waitFor(() => expect(within(dialog).getAllByRole('listitem')).toHaveLength(1))
    expect(calls(fetchMock, 'DELETE')).toEqual(['/api/drive/shares/5'])
  })
})

describe('FileBrowser (Drive): encryption', () => {
  it('encrypts a document with a password', async () => {
    const fetchMock = mockApi({
      ...ME,
      'GET /api/drive/items': { body: TOP },
      'POST /api/drive/files/10/encrypt': { body: file(10, 'report.pdf', { is_encrypted: true }) },
    })
    renderFiles()
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
    renderFiles()
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
})

describe('FileBrowser (Drive): move, search, trash', () => {
  const FOLDERS = [folder(3, 'Work'), folder(4, 'Reports', 3), folder(7, 'Archive')]

  it('moves the selected documents to the chosen folder', async () => {
    const fetchMock = mockApi({
      ...ME,
      'GET /api/drive/items': { body: TOP },
      'GET /api/drive/folders': { body: { items: FOLDERS } },
      'PATCH /api/drive/files/10': { body: file(10, 'report.pdf', { folder_id: 4 }) },
      'PATCH /api/drive/files/11': { body: file(11, 'plan.pdf', { folder_id: 4 }) },
    })
    renderFiles()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('checkbox', { name: 'Select report.pdf' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select plan.pdf' }))
    await user.click(screen.getByRole('button', { name: 'Move' }))

    const dialog = screen.getByRole('dialog', { name: 'Move 2 items' })
    await user.click(await within(dialog).findByRole('radio', { name: 'Reports' }))
    await user.click(within(dialog).getByRole('button', { name: 'Move here' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls(fetchMock, 'PATCH')).toEqual(['/api/drive/files/10', '/api/drive/files/11'])
    expect(lastBody(fetchMock, 'PATCH /api/drive/files/11')).toEqual({ folder_id: 4 })
  })

  it('does not let a folder be moved into itself or its subfolders', async () => {
    const fetchMock = mockApi({
      ...ME,
      'GET /api/drive/items': { body: TOP },
      'GET /api/drive/folders': { body: { items: FOLDERS } },
      'PATCH /api/drive/folders/3': { body: folder(3, 'Work', 7) },
    })
    renderFiles()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Move folder Work' }))
    const dialog = screen.getByRole('dialog', { name: 'Move Work' })
    expect(await within(dialog).findByRole('radio', { name: 'Work' })).toBeDisabled()
    expect(within(dialog).getByRole('radio', { name: 'Reports' })).toBeDisabled()
    expect(within(dialog).getByRole('radio', { name: 'Drive (top level)' })).toBeEnabled()

    // Nothing chosen yet
    await user.click(within(dialog).getByRole('button', { name: 'Move here' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose where to move to.')

    await user.click(within(dialog).getByRole('radio', { name: 'Archive' }))
    await user.click(within(dialog).getByRole('button', { name: 'Move here' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(lastBody(fetchMock, 'PATCH /api/drive/folders/3')).toEqual({ parent_id: 7 })
  })

  it('searches by name and shows where each result is', async () => {
    mockApi({
      ...ME,
      'GET /api/drive/items': { body: TOP },
      'GET /api/drive/search?q=q4%20report': {
        body: {
          folders: [folder(8, 'Q4 reports', 3, { path: 'Work' })],
          files: [file(12, 'q4 report.pdf', { folder_id: 4, path: 'Work / Reports' })],
        },
      },
      'GET /api/drive/search?q=nothing': { body: { folders: [], files: [] } },
    })
    renderFiles()
    const user = userEvent.setup()

    await user.type(await screen.findByRole('searchbox', { name: 'Search Drive' }), 'q4 report{Enter}')

    expect(await screen.findByRole('heading', { name: 'Results for “q4 report”' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'q4 report.pdf' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Work / Reports' })).toHaveAttribute('href', '/drive?folder=4')
    expect(screen.getByRole('link', { name: 'Q4 reports' })).toHaveAttribute('href', '/drive?folder=8')
    // Selecting is for browsing; results are opened or located
    expect(screen.queryByRole('checkbox', { name: 'Select all' })).not.toBeInTheDocument()

    await user.clear(screen.getByRole('searchbox'))
    await user.type(screen.getByRole('searchbox'), 'nothing{Enter}')
    expect(await screen.findByText('Nothing found for “nothing”.')).toBeInTheDocument()
  })

  it('moves documents to the trash instead of deleting them', async () => {
    const fetchMock = mockApi({
      ...ME,
      'GET /api/drive/items': { body: TOP },
      'DELETE /api/drive/files/10': { status: 204 },
      'DELETE /api/drive/files/11': { status: 204 },
      'DELETE /api/drive/folders/3': { status: 204 },
    })
    renderFiles()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('checkbox', { name: 'Select all' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('dialog', { name: 'Move to trash' })
    expect(dialog).toHaveTextContent('Move 1 folder and 2 documents to the trash?')
    expect(dialog).toHaveTextContent('You can restore it from the trash later.')
    await user.click(within(dialog).getByRole('button', { name: 'Move to trash' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // No "?permanent=1": these are recoverable
    expect(calls(fetchMock, 'DELETE')).toEqual([
      '/api/drive/folders/3',
      '/api/drive/files/10',
      '/api/drive/files/11',
    ])
  })

  it('shows the trash, restores an item and deletes one forever', async () => {
    let trash = {
      folders: [folder(3, 'Old work', null, { deleted_at: WHEN, path: '' })],
      files: [file(10, 'report.pdf', { deleted_at: WHEN, path: 'Work / Reports' })],
    }
    const fetchMock = mockApi({
      ...ME,
      'GET /api/drive/trash': () => ({ body: trash }),
      'POST /api/drive/trash/restore': () => {
        trash = { ...trash, files: [] }
        return { status: 204 }
      },
      'DELETE /api/drive/folders/3?permanent=1': () => {
        trash = { ...trash, folders: [] }
        return { status: 204 }
      },
    })
    renderFiles('/drive?view=trash')
    const user = userEvent.setup()

    expect(await screen.findByRole('heading', { name: 'Trash' })).toBeInTheDocument()
    const row = screen.getByText('report.pdf').closest('tr')!
    expect(within(row).getByText('Work / Reports')).toBeInTheDocument()
    // The trash is not a place to upload or create things
    expect(screen.queryByRole('button', { name: 'Upload' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Restore report.pdf' }))
    await waitFor(() => expect(screen.queryByText('report.pdf')).not.toBeInTheDocument())
    expect(lastBody(fetchMock, 'POST /api/drive/trash/restore')).toEqual({ file_ids: [10], folder_ids: [] })

    await user.click(screen.getByRole('button', { name: 'Delete Old work forever' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete forever' })
    expect(dialog).toHaveTextContent('This cannot be undone.')
    await user.click(within(dialog).getByRole('button', { name: 'Delete forever' }))

    expect(await screen.findByText('The trash is empty.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Empty trash' })).toBeDisabled()
  })

  it('empties the trash after confirmation', async () => {
    let emptied = false
    const fetchMock = mockApi({
      ...ME,
      'GET /api/drive/trash': () => ({
        body: { folders: [], files: emptied ? [] : [file(10, 'report.pdf', { deleted_at: WHEN, path: '' })] },
      }),
      'DELETE /api/drive/trash': () => {
        emptied = true
        return { status: 204 }
      },
    })
    renderFiles('/drive?view=trash')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Empty trash' }))
    expect(calls(fetchMock, 'DELETE')).toEqual([])
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Empty trash' }))

    expect(await screen.findByText('The trash is empty.')).toBeInTheDocument()
  })
})

describe('FileBrowser (Drive): opening documents', () => {
  const DOCS: Listing = {
    folder: null,
    breadcrumbs: [],
    folders: [],
    files: [
      file(20, 'notes.txt', { mime_type: 'text/plain' }),
      file(21, 'table.csv', { mime_type: 'text/csv' }),
      file(22, 'letter.html', { mime_type: 'text/html' }),
      file(23, 'report.docx', { mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    ],
  }

  it('edits a spreadsheet as a grid and saves it as CSV', async () => {
    const fetchMock = mockApi({
      ...ME,
      'GET /api/drive/items': { body: DOCS },
      'GET /api/drive/files/21/content': { text: 'Item,Cost\nRent,"1,200"\n' },
      'PUT /api/drive/files/21/text': { body: DOCS.files[1] },
    })
    renderFiles()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'table.csv' }))
    const dialog = await screen.findByRole('dialog', { name: 'table.csv' })
    expect(within(dialog).getByRole('textbox', { name: 'A1' })).toHaveValue('Item')
    expect(within(dialog).getByRole('textbox', { name: 'B2' })).toHaveValue('1,200') // quoted cell

    await user.type(within(dialog).getByRole('textbox', { name: 'A3' }), 'Food')
    await user.type(within(dialog).getByRole('textbox', { name: 'B3' }), '350')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(lastBody(fetchMock, 'PUT /api/drive/files/21/text')).toEqual({
      content: 'Item,Cost\nRent,"1,200"\nFood,350\n',
    })
  })

  it('opens a formatted document with anything dangerous removed', async () => {
    const fetchMock = mockApi({
      ...ME,
      'GET /api/drive/items': { body: DOCS },
      'GET /api/drive/files/22/content': {
        text: '<h2>Hello</h2><p onclick="steal()">Dear <b>Ana</b></p><script>steal()</script><img src=x onerror=steal()>',
      },
      'PUT /api/drive/files/22/text': { body: DOCS.files[2] },
    })
    renderFiles()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'letter.html' }))
    const dialog = await screen.findByRole('dialog', { name: 'letter.html' })
    const editor = within(dialog).getByRole('textbox', { name: 'Document' })
    expect(within(editor).getByRole('heading', { name: 'Hello' })).toBeInTheDocument()
    expect(editor.innerHTML).toBe('<h2>Hello</h2><p>Dear <b>Ana</b></p>')
    expect(within(dialog).getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Bold' })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(lastBody(fetchMock, 'PUT /api/drive/files/22/text')).toEqual({
      content: '<h2>Hello</h2><p>Dear <b>Ana</b></p>',
    })
  })

  it('edits a plain text document', async () => {
    const fetchMock = mockApi({
      ...ME,
      'GET /api/drive/items': { body: DOCS },
      'GET /api/drive/files/20/content': { text: 'old text' },
      'PUT /api/drive/files/20/text': { body: DOCS.files[0] },
    })
    renderFiles()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'notes.txt' }))
    const dialog = await screen.findByRole('dialog', { name: 'notes.txt' })
    const box = within(dialog).getByRole('textbox')
    expect(box).toHaveValue('old text')
    await user.clear(box)
    await user.type(box, 'new text')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(lastBody(fetchMock, 'PUT /api/drive/files/20/text')).toEqual({ content: 'new text' })
  })

  it('previews a Word document as text', async () => {
    mockApi({
      ...ME,
      'GET /api/drive/items': { body: DOCS },
      'GET /api/drive/files/23/preview': {
        body: {
          kind: 'document',
          truncated: false,
          blocks: [
            { type: 'heading', level: 1, text: 'Quarterly report' },
            { type: 'paragraph', text: 'Sales grew by 12%.' },
            { type: 'table', rows: [['Region', 'Sales'], ['North', '120']] },
          ],
        },
      },
    })
    renderFiles()

    await userEvent.click(await screen.findByRole('button', { name: 'report.docx' }))
    const dialog = screen.getByRole('dialog', { name: 'report.docx' })
    expect(await within(dialog).findByRole('heading', { name: 'Quarterly report' })).toBeInTheDocument()
    expect(within(dialog).getByText('Sales grew by 12%.')).toBeInTheDocument()
    expect(within(dialog).getByRole('cell', { name: 'North' })).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      '/api/drive/files/23/content?download=1',
    )
  })

  it('explains when a file cannot be previewed', async () => {
    mockApi({
      ...ME,
      'GET /api/drive/items': { body: DOCS },
      'GET /api/drive/files/23/preview': {
        status: 422,
        body: { error: 'This file could not be read. It may be damaged.' },
      },
    })
    renderFiles()

    await userEvent.click(await screen.findByRole('button', { name: 'report.docx' }))
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('may be damaged')
  })
})

describe('FileBrowser (Photos)', () => {
  const PHOTOS: Listing = {
    folder: null,
    breadcrumbs: [],
    folders: [folder(5, 'Holiday')],
    files: [
      file(20, 'beach.jpg', {
        mime_type: 'image/jpeg',
        width: 4000,
        height: 3000,
        taken_at: '2026-07-14T18:30:05',
        camera: 'Canon EOS 80D',
      }),
      file(21, 'forest.jpg', { mime_type: 'image/jpeg' }),
      file(22, 'sea.jpg', { mime_type: 'image/jpeg' }),
    ],
  }

  it('shows albums and thumbnails, with sharing but without encryption or documents', async () => {
    const fetchMock = mockApi({
      ...ME,
      'GET /api/photos/items': { body: PHOTOS },
      'GET /api/friends': { body: { items: FRIENDS } },
      'POST /api/packages': { status: 201, body: { id: 7 } },
      'POST /api/packages/7/send': {
        body: { link: 'http://localhost/shared/tok', sent: ['bo@example.com'], failed: [] },
      },
    })
    renderFiles('/photos')
    const user = userEvent.setup()

    // The grid loads the small version, not the full photo
    expect(await screen.findByRole('img', { name: 'beach.jpg' })).toHaveAttribute(
      'src',
      '/api/photos/files/20/thumb',
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
    expect(lastBody(fetchMock, 'POST /api/packages')).toEqual({
      name: 'beach.jpg',
      message: '',
      file_ids: [20],
      folder_ids: [],
      friend_ids: [2],
    })
  })

  it('opens a photo full size with its details and steps through the others', async () => {
    mockApi({ ...ME, 'GET /api/photos/items': { body: PHOTOS } })
    renderFiles('/photos')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('img', { name: 'beach.jpg' }))
    const dialog = screen.getByRole('dialog', { name: 'beach.jpg' })
    expect(within(dialog).getByRole('img', { name: 'beach.jpg' })).toHaveAttribute(
      'src',
      '/api/photos/files/20/content',
    )
    expect(dialog).toHaveTextContent('1 of 3')
    expect(dialog).toHaveTextContent('4000 × 3000')
    expect(dialog).toHaveTextContent('Canon EOS 80D')
    expect(within(dialog).getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      '/api/photos/files/20/content?download=1',
    )

    await user.click(within(dialog).getByRole('button', { name: 'Next photo' }))
    expect(screen.getByRole('dialog', { name: 'forest.jpg' })).toHaveTextContent('2 of 3')

    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('dialog', { name: 'sea.jpg' })).toBeInTheDocument()
    await user.keyboard('{ArrowRight}') // wraps round
    expect(screen.getByRole('dialog', { name: 'beach.jpg' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Previous photo' }))
    expect(screen.getByRole('dialog', { name: 'sea.jpg' })).toBeInTheDocument()
  })

  it('can show photos as a list, which still opens the viewer', async () => {
    mockApi({ ...ME, 'GET /api/photos/items': { body: PHOTOS } })
    renderFiles('/photos')
    const user = userEvent.setup()

    await screen.findByRole('img', { name: 'beach.jpg' })
    expect(screen.getByRole('button', { name: 'Grid view' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'List view' }))

    const row = screen.getByRole('button', { name: 'beach.jpg' }).closest('tr')!
    expect(within(row).getByRole('checkbox', { name: 'Select beach.jpg' })).toBeInTheDocument()
    expect(within(row).getByText('2.0 KB')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'beach.jpg' }))
    expect(screen.getByRole('dialog', { name: 'beach.jpg' })).toHaveTextContent('1 of 3')
  })

  it('offers a slideshow that can be started and paused', async () => {
    mockApi({ ...ME, 'GET /api/photos/items': { body: PHOTOS } })
    renderFiles('/photos')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('img', { name: 'beach.jpg' }))
    const play = screen.getByRole('button', { name: 'Play slideshow' })
    expect(play).toHaveAttribute('aria-pressed', 'false')
    await user.click(play)
    expect(screen.getByRole('button', { name: 'Pause slideshow' })).toHaveAttribute('aria-pressed', 'true')
  })
})
