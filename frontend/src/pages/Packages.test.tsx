import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { FileItem, Folder, Listing, Package } from '../api'
import { USER, lastBody, mockApi, renderApp } from '../test/utils'
import Packages from './Packages'

const ME = { 'GET /api/auth/me': { body: { user: USER } } }

const ANA = { id: 1, first_name: 'Ana', last_name: 'Kovač', email: 'ana@example.com', address: '', country: '', mobile: '' }
const BOB = { ...ANA, id: 2, first_name: 'Bob', last_name: '', email: 'bob@example.com' }
const FRIENDS = { 'GET /api/friends': { body: { items: [ANA, BOB] } } }

function file(id: number, name: string, folder_id: number | null = null): FileItem {
  return {
    id,
    name,
    folder_id,
    mime_type: 'text/plain',
    size: 10,
    is_encrypted: false,
    created_at: '2026-11-20T08:00:00+00:00',
    updated_at: '2026-11-20T08:00:00+00:00',
    deleted_at: null,
    width: null,
    height: null,
    taken_at: null,
    camera: null,
  }
}

function folder(id: number, name: string, parent_id: number | null = null): Folder {
  return { id, name, parent_id, created_at: '2026-11-20T08:00:00+00:00', deleted_at: null }
}

const WORK = folder(5, 'Work')
const ALBUM = folder(6, 'Trip')

// Drive: top.txt and the folder Work, which holds deep.txt. Photos: cat.png and the album Trip.
const BROWSE = {
  'GET /api/drive/items': {
    body: { folder: null, breadcrumbs: [], folders: [WORK], files: [file(10, 'top.txt')] } satisfies Listing,
  },
  'GET /api/drive/items?folder=5': {
    body: {
      folder: WORK,
      breadcrumbs: [{ id: 5, name: 'Work' }],
      folders: [],
      files: [file(11, 'deep.txt', 5)],
    } satisfies Listing,
  },
  'GET /api/photos/items': {
    body: { folder: null, breadcrumbs: [], folders: [ALBUM], files: [file(12, 'cat.png')] } satisfies Listing,
  },
}

const PACKAGE: Package = {
  id: 3,
  name: 'For the board',
  message: 'Please read',
  link: 'http://frontend.test/shared/tok',
  created_at: '2026-11-21T08:00:00+00:00',
  updated_at: '2026-11-21T08:00:00+00:00',
  expires_at: '2026-12-21T08:00:00+00:00',
  expired: false,
  file_count: 4,
  files: [{ ...file(11, 'deep.txt', 5), app: 'drive', path: 'Work' }],
  folders: [{ ...ALBUM, app: 'photos', path: '', file_count: 3 }],
  friends: [ANA],
  sends: [],
}

const SENT: Package = {
  ...PACKAGE,
  sends: [
    {
      id: 8,
      sent_at: '2026-11-22T09:30:00+00:00',
      message: 'Please read',
      friends: [
        { name: 'Ana Kovač', email: 'ana@example.com', sent: true },
        { name: 'Bob', email: 'bob@example.com', sent: false },
      ],
      items: [
        { kind: 'folder', app: 'photos', name: 'Trip', path: '', file_count: 3 },
        { kind: 'file', app: 'drive', name: 'old.txt', path: 'Work' },
      ],
    },
  ],
}

describe('Packages', () => {
  it('shows an empty state', async () => {
    mockApi({ ...ME, 'GET /api/packages': { body: { items: [] } } })
    renderApp(<Packages />)
    expect(await screen.findByText(/No packages yet/)).toBeInTheDocument()
  })

  it('switches between a list and a grid of packages', async () => {
    mockApi({ ...ME, 'GET /api/packages': { body: { items: [PACKAGE] } } })
    renderApp(<Packages />)
    const user = userEvent.setup()

    const list = await screen.findByRole('list', { name: 'Packages' })
    expect(list).not.toHaveClass('grid')
    await user.click(screen.getByRole('button', { name: 'Grid view' }))
    expect(list).toHaveClass('grid')
    expect(screen.getByRole('button', { name: 'Grid view' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(list).getByRole('listitem', { name: 'For the board' })).toBeInTheDocument()
  })

  it('lists a package with its contents, friends and link', async () => {
    mockApi({ ...ME, 'GET /api/packages': { body: { items: [PACKAGE] } } })
    renderApp(<Packages />)

    const card = await screen.findByRole('listitem', { name: 'For the board' })
    expect(within(card).getByText('Not sent yet')).toBeInTheDocument()
    expect(within(card).getByText(/4 files · to ana@example.com/)).toBeInTheDocument()

    const contents = within(card).getByRole('list', { name: 'Contents of For the board' })
    expect(within(contents).getByText('Trip')).toBeInTheDocument()
    expect(within(contents).getByText('3 files · in Photos')).toBeInTheDocument()
    expect(within(contents).getByText('deep.txt')).toBeInTheDocument()
    expect(within(contents).getByText('in Drive / Work')).toBeInTheDocument()

    expect(within(card).getByText('Please read')).toBeInTheDocument()
    expect(within(card).getByLabelText('Link of For the board')).toHaveValue('http://frontend.test/shared/tok')
  })

  it('creates a package from files and folders in different folders and apps', async () => {
    const items: Package[] = []
    const fetchMock = mockApi({
      ...ME,
      ...FRIENDS,
      ...BROWSE,
      'GET /api/packages': () => ({ body: { items } }),
      'POST /api/packages': () => {
        items.push(PACKAGE)
        return { status: 201, body: PACKAGE }
      },
    })
    const user = userEvent.setup()
    renderApp(<Packages />)

    await user.click(await screen.findByRole('button', { name: 'New package' }))
    await user.type(screen.getByLabelText('Name'), 'For the board')
    expect(screen.getByText('Nothing added yet.')).toBeInTheDocument()

    // Tick a file at the top of Drive, one inside a folder, and an album of Photos
    await user.click(screen.getByRole('button', { name: 'Add files or folders' }))
    await user.click(await screen.findByLabelText('Select top.txt'))
    await user.click(screen.getByRole('button', { name: 'Open folder Work' }))
    await user.click(await screen.findByLabelText('Select deep.txt'))
    await user.click(screen.getByRole('button', { name: 'Photos' }))
    await user.click(await screen.findByLabelText('Select folder Trip'))
    expect(screen.getByText(/3 selected/)).toBeInTheDocument()

    // Going back keeps the ticks
    await user.click(screen.getByRole('button', { name: 'Drive' }))
    expect(await screen.findByLabelText('Select top.txt')).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Done' }))

    const contents = screen.getByRole('list', { name: 'Package contents' })
    expect(within(contents).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      ' top.txtin Drive',
      ' deep.txtin Drive / Work',
      ' Tripfolder · in Photos',
    ])
    // The name typed before picking is still there
    expect(screen.getByLabelText('Name')).toHaveValue('For the board')

    await user.click(screen.getByRole('button', { name: 'Remove top.txt' }))
    await user.click(await screen.findByLabelText(/Ana Kovač/))
    await user.type(screen.getByLabelText('Message (optional)'), 'Please read')
    await user.click(screen.getByRole('button', { name: 'Create package' }))

    expect(await screen.findByRole('listitem', { name: 'For the board' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(lastBody(fetchMock, 'POST /api/packages')).toEqual({
      name: 'For the board',
      message: 'Please read',
      file_ids: [11],
      folder_ids: [6],
      friend_ids: [1],
    })
  })

  it('does not save a package with nothing in it', async () => {
    mockApi({ ...ME, ...FRIENDS, 'GET /api/packages': { body: { items: [] } } })
    const user = userEvent.setup()
    renderApp(<Packages />)

    await user.click(await screen.findByRole('button', { name: 'New package' }))
    await user.type(screen.getByLabelText('Name'), 'Empty')
    await user.click(screen.getByRole('button', { name: 'Create package' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Add at least one file or folder.')
  })

  it('edits a package', async () => {
    let current = PACKAGE
    const fetchMock = mockApi({
      ...ME,
      ...FRIENDS,
      ...BROWSE,
      'GET /api/packages': () => ({ body: { items: [current] } }),
      'PATCH /api/packages/3': () => {
        current = { ...PACKAGE, name: 'For everyone' }
        return { body: current }
      },
    })
    const user = userEvent.setup()
    renderApp(<Packages />)

    await user.click(await screen.findByRole('button', { name: 'Edit For the board' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit package' })

    // The form starts with what the package has
    expect(within(dialog).getByLabelText('Name')).toHaveValue('For the board')
    expect(within(dialog).getByLabelText('Message (optional)')).toHaveValue('Please read')
    expect(await within(dialog).findByLabelText(/Ana Kovač/)).toBeChecked()
    expect(within(dialog).getByLabelText(/Bob/)).not.toBeChecked()

    await user.clear(within(dialog).getByLabelText('Name'))
    await user.type(within(dialog).getByLabelText('Name'), 'For everyone')
    await user.click(within(dialog).getByRole('button', { name: 'Remove deep.txt' }))
    await user.click(within(dialog).getByRole('button', { name: 'Add files or folders' }))
    await user.click(await screen.findByLabelText('Select top.txt'))
    await user.click(screen.getByRole('button', { name: 'Done' }))
    await user.click(screen.getByLabelText(/Bob/))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('listitem', { name: 'For everyone' })).toBeInTheDocument()
    expect(lastBody(fetchMock, 'PATCH /api/packages/3')).toEqual({
      name: 'For everyone',
      message: 'Please read',
      file_ids: [10],
      folder_ids: [6],
      friend_ids: [1, 2],
    })
  })

  it('sends a package and shows who got it', async () => {
    let current = PACKAGE
    const fetchMock = mockApi({
      ...ME,
      'GET /api/packages': () => ({ body: { items: [current] } }),
      'POST /api/packages/3/send': () => {
        current = SENT
        return {
          body: { package: SENT, link: PACKAGE.link, sent: ['ana@example.com'], failed: ['bob@example.com'] },
        }
      },
    })
    const user = userEvent.setup()
    renderApp(<Packages />)

    await user.click(await screen.findByRole('button', { name: 'Send For the board' }))
    const dialog = screen.getByRole('dialog', { name: 'Send “For the board”' })
    expect(within(dialog).getByText(/Email the link to 4 files to ana@example.com\?/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/packages/3/send', expect.anything())

    await user.click(within(dialog).getByRole('button', { name: 'Send' }))

    expect(await within(dialog).findByRole('status')).toHaveTextContent('Link emailed to ana@example.com.')
    expect(within(dialog).getByRole('alert')).toHaveTextContent('could not be sent to bob@example.com')
    expect(within(dialog).getByLabelText('Link')).toHaveValue(PACKAGE.link)

    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    // The list behind the dialog now shows the send
    expect(screen.getByText(/History: sent 1 time/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send For the board' })).toHaveTextContent('Send again')
  })

  it('will not send a package that has no friends', async () => {
    mockApi({ ...ME, 'GET /api/packages': { body: { items: [{ ...PACKAGE, friends: [] }] } } })
    const user = userEvent.setup()
    renderApp(<Packages />)

    await user.click(await screen.findByRole('button', { name: 'Send For the board' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('alert')).toHaveTextContent('This package has no friends.')
    expect(within(dialog).getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('shows the history of what was sent to whom', async () => {
    mockApi({ ...ME, 'GET /api/packages': { body: { items: [SENT] } } })
    renderApp(<Packages />)

    const history = await screen.findByRole('list', { name: 'History of For the board' })
    const record = within(history).getByRole('listitem')
    expect(record).toHaveTextContent('Ana Kovač (ana@example.com)')
    expect(record).toHaveTextContent('Bob (bob@example.com)not delivered')
    // What was in the package then, not what is in it now
    expect(record).toHaveTextContent('Trip (folder, 3 files), old.txt')
    expect(record).toHaveTextContent('“Please read”')
  })

  it('deletes a package after confirming', async () => {
    let items = [PACKAGE]
    const fetchMock = mockApi({
      ...ME,
      'GET /api/packages': () => ({ body: { items } }),
      'DELETE /api/packages/3': () => {
        items = []
        return { status: 204 }
      },
    })
    const user = userEvent.setup()
    renderApp(<Packages />)

    await user.click(await screen.findByRole('button', { name: 'Delete For the board' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete package' })
    expect(within(dialog).getByText(/The files stay in Drive and Photos/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText(/No packages yet/)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/packages/3', expect.objectContaining({ method: 'DELETE' }))
  })
})
