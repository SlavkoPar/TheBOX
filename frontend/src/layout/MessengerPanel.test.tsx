import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { ChatMessage, Conversation } from '../api'
import Home from '../pages/Home'
import Messenger from '../pages/Messenger'
import Recipients from '../pages/Recipients'
import { USER, lastBody, mockApi, renderApp } from '../test/utils'
import AppLayout from './AppLayout'

const ME = { 'GET /api/auth/me': { body: { user: USER } } }

const HELLO: ChatMessage = { id: 1, body: 'Hello Ana', created_at: '2026-11-20T09:00:00+00:00', mine: true }
const REPLY: ChatMessage = { id: 2, body: 'Hi there', created_at: '2026-11-20T09:05:00+00:00', mine: false }

const ANA: Conversation = { email: 'ana@example.com', name: 'Ana Kovač', recipient_id: 1, unread: 1, last: REPLY }
const BOB: Conversation = { email: 'bob@example.com', name: 'Bob', recipient_id: 2, unread: 0, last: null }
const STRANGER: Conversation = {
  email: 'new@example.com',
  name: 'new@example.com',
  recipient_id: null,
  unread: 2,
  last: { ...REPLY, id: 9, body: 'Do you remember me?' },
}

const PEOPLE = 'GET /api/messenger/conversations'
const CHAT_ANA = 'GET /api/messenger/messages?with=ana%40example.com'

function renderShell(route = '/drive') {
  return renderApp(
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/drive" element={<p>drive page</p>} />
        <Route path="/recipients" element={<Recipients />} />
        <Route path="/messenger" element={<Messenger />} />
      </Route>
    </Routes>,
    route,
  )
}

/** Open the panel with the header button. */
async function openPanel(user = userEvent.setup()) {
  await user.click(await screen.findByRole('button', { name: /^Messenger/ }))
  return screen.getByRole('complementary', { name: 'Messenger' })
}

const FILES_MESSAGE: ChatMessage = {
  id: 5,
  body: '',
  created_at: '2026-11-20T09:20:00+00:00',
  mine: false,
  files: [
    { id: 31, name: 'cat.png', mime_type: 'image/png', size: 2048, is_encrypted: false },
    { id: 32, name: 'budget.xlsx', mime_type: 'application/vnd.ms-excel', size: 4096, is_encrypted: false },
    { id: 33, name: 'secret.txt', mime_type: 'text/plain', size: 10, is_encrypted: true },
  ],
}

describe('Files in the Messenger', () => {
  it('shows the files of a message, to open and to download', async () => {
    mockApi({
      ...ME,
      [PEOPLE]: { body: { items: [{ ...ANA, last: FILES_MESSAGE }] } },
      [CHAT_ANA]: { body: { items: [FILES_MESSAGE] } },
      [`${CHAT_ANA}&after=5`]: { body: { items: [] } },
    })
    renderShell()
    const user = userEvent.setup()

    const panel = await openPanel(user)
    // In the list of people a message without text is told by its files
    const ana = await within(panel).findByRole('button', { name: /Ana Kovač/ })
    expect(ana).toHaveTextContent('cat.png and 2 more')
    await user.click(ana)

    const files = await within(panel).findByRole('list', { name: 'Files' })
    const base = '/api/messenger/messages/5/files'
    // A picture is shown; it opens in the browser
    expect(within(files).getByRole('img', { name: 'cat.png' })).toHaveAttribute('src', `${base}/31/thumb`)
    expect(within(files).getByRole('link', { name: 'Open cat.png' })).toHaveAttribute('href', `${base}/31`)
    // What a browser cannot show is downloaded
    expect(within(files).getByRole('link', { name: 'Open budget.xlsx' })).toHaveAttribute(
      'href',
      `${base}/32?download=1`,
    )
    expect(within(files).getByRole('link', { name: 'Download cat.png' })).toHaveAttribute(
      'href',
      `${base}/31?download=1`,
    )
    // An encrypted document asks for its password
    await user.click(within(files).getByRole('button', { name: 'Unlock and download secret.txt' }))
    expect(await screen.findByRole('dialog', { name: 'Unlock secret.txt' })).toHaveTextContent(
      'Ask Ana Kovač for the password.',
    )
  })

  it('attaches files and folders from Drive and Photos and sends them', async () => {
    const fetchMock = mockApi({
      ...ME,
      [PEOPLE]: { body: { items: [BOB] } },
      'GET /api/messenger/messages?with=bob%40example.com': { body: { items: [] } },
      'GET /api/messenger/messages?with=bob%40example.com&after=7': { body: { items: [] } },
      'GET /api/drive/items': {
        body: {
          folder: null,
          breadcrumbs: [],
          folders: [{ id: 4, name: 'Work', parent_id: null }],
          files: [
            { id: 11, name: 'report.txt', is_encrypted: false },
            { id: 12, name: 'notes.txt', is_encrypted: false },
          ],
        },
      },
      'POST /api/messenger/messages': {
        status: 201,
        body: {
          id: 7,
          body: '',
          created_at: '2026-11-20T09:30:00+00:00',
          mine: true,
          files: [{ id: 11, name: 'report.txt', mime_type: 'text/plain', size: 10, is_encrypted: false }],
        },
      },
    })
    renderShell()
    const user = userEvent.setup()

    const panel = await openPanel(user)
    await user.click(await within(panel).findByRole('button', { name: /Bob/ }))
    const chat = await within(panel).findByRole('region', { name: 'Chat with Bob' })
    const sendButton = within(chat).getByRole('button', { name: 'Send' })
    expect(sendButton).toBeDisabled()

    await user.click(within(chat).getByRole('button', { name: 'Attach files' }))
    const dialog = await screen.findByRole('dialog', { name: 'Attach files and folders' })
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Select report.txt' }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'Select notes.txt' }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'Select folder Work' }))
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))

    // What is attached waits above the message, and can be taken off again
    const attached = within(chat).getByRole('list', { name: 'Attached' })
    expect(within(attached).getAllByRole('listitem')).toHaveLength(3)
    await user.click(within(attached).getByRole('button', { name: 'Remove notes.txt' }))

    // Files are enough: no text is needed
    expect(sendButton).toBeEnabled()
    await user.click(sendButton)

    const log = within(chat).getByRole('log')
    expect(await within(log).findByRole('link', { name: 'Open report.txt' })).toBeInTheDocument()
    expect(lastBody(fetchMock, 'POST /api/messenger/messages')).toEqual({
      to: 'bob@example.com',
      body: '',
      file_ids: [11],
      folder_ids: [4],
    })
    expect(within(chat).queryByRole('list', { name: 'Attached' })).not.toBeInTheDocument()
  })
})

describe('Messenger panel', () => {
  it('shows the unread count in the header and stays closed until asked', async () => {
    mockApi({ ...ME, [PEOPLE]: { body: { items: [ANA, STRANGER] } } })
    renderShell()

    const toggle = await screen.findByRole('button', { name: 'Messenger, 3 unread' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('complementary', { name: 'Messenger' })).not.toBeInTheDocument()
  })

  it('slides in over the current page, lists the recipients, and closes again', async () => {
    mockApi({ ...ME, [PEOPLE]: { body: { items: [ANA, { ...BOB, online: true }] } } })
    renderShell()
    const user = userEvent.setup()

    const panel = await openPanel(user)
    // The page underneath is still there
    expect(screen.getByText('drive page')).toBeInTheDocument()

    const chats = await within(panel).findByRole('navigation', { name: 'Chats' })
    const ana = within(chats).getByRole('button', { name: /Ana Kovač/ })
    expect(within(ana).getByLabelText('1 unread')).toHaveTextContent('1')
    expect(ana).toHaveTextContent('Hi there')
    expect(within(chats).getByRole('button', { name: /Bob/ })).toHaveTextContent('No messages yet')
    // Bob is signed in right now, Ana is not
    expect(within(within(chats).getByRole('button', { name: /Bob/ })).getByRole('img', { name: 'Online' })).toBeInTheDocument()
    expect(within(ana).queryByRole('img', { name: 'Online' })).not.toBeInTheDocument()

    await user.click(within(panel).getByRole('button', { name: 'Close Messenger' }))
    expect(screen.queryByRole('complementary', { name: 'Messenger' })).not.toBeInTheDocument()

    // Escape closes it too
    await openPanel(user)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('complementary', { name: 'Messenger' })).not.toBeInTheDocument()
  })

  it('opens a chat, sends a message with Enter, and goes back to the list', async () => {
    let people = [ANA, BOB]
    const fetchMock = mockApi({
      ...ME,
      [PEOPLE]: () => ({ body: { items: people } }),
      [CHAT_ANA]: { body: { items: [HELLO, REPLY] } },
      [`${CHAT_ANA}&after=2`]: { body: { items: [] } },
      'POST /api/messenger/messages': () => {
        people = [{ ...ANA, unread: 0 }, BOB]
        return {
          status: 201,
          body: { id: 3, body: 'See you at 5', created_at: '2026-11-20T09:10:00+00:00', mine: true },
        }
      },
    })
    renderShell()
    const user = userEvent.setup()

    const panel = await openPanel(user)
    await user.click(await within(panel).findByRole('button', { name: /Ana Kovač/ }))
    const chat = await within(panel).findByRole('region', { name: 'Chat with Ana Kovač' })
    const log = within(chat).getByRole('log')
    expect(await within(log).findByText('Hello Ana')).toBeInTheDocument()
    expect(within(log).getByText('Hi there').closest('.chat-row')).toHaveClass('theirs')
    expect(within(log).getByText('Hello Ana').closest('.chat-row')).toHaveClass('mine')

    const send = within(chat).getByRole('button', { name: 'Send' })
    expect(send).toBeDisabled()
    const box = within(chat).getByRole('textbox', { name: 'Message to Ana Kovač' })
    await user.type(box, 'See you at 5{Enter}')

    expect(await within(log).findByText('See you at 5')).toBeInTheDocument()
    expect(lastBody(fetchMock, 'POST /api/messenger/messages')).toEqual({
      to: 'ana@example.com',
      body: 'See you at 5',
    })
    expect(box).toHaveValue('')
    // The list was reloaded: nothing unread any more
    expect(await screen.findByRole('button', { name: 'Messenger' })).toBeInTheDocument()

    await user.click(within(panel).getByRole('button', { name: 'Back to all chats' }))
    expect(within(panel).getByRole('navigation', { name: 'Chats' })).toBeInTheDocument()
  })

  it('keeps the text and shows the error when a message cannot be sent', async () => {
    mockApi({
      ...ME,
      [PEOPLE]: { body: { items: [BOB] } },
      'GET /api/messenger/messages?with=bob%40example.com': { body: { items: [] } },
      'POST /api/messenger/messages': { status: 400, body: { error: 'Message is required.' } },
    })
    renderShell()
    const user = userEvent.setup()

    const panel = await openPanel(user)
    await user.click(await within(panel).findByRole('button', { name: /Bob/ }))
    expect(await screen.findByText(/No messages yet. Write the first one/)).toBeInTheDocument()
    const box = screen.getByRole('textbox', { name: 'Message to Bob' })
    await user.type(box, 'Hello')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(await within(panel).findByRole('alert')).toHaveTextContent('Message is required.')
    expect(box).toHaveValue('Hello')
  })

  it('deletes my own message after asking', async () => {
    const fetchMock = mockApi({
      ...ME,
      [PEOPLE]: { body: { items: [ANA] } },
      [CHAT_ANA]: { body: { items: [HELLO, REPLY] } },
      'DELETE /api/messenger/messages/1': { status: 204 },
    })
    renderShell()
    const user = userEvent.setup()

    const panel = await openPanel(user)
    await user.click(await within(panel).findByRole('button', { name: /Ana Kovač/ }))
    const log = await within(panel).findByRole('log')
    await within(log).findByText('Hello Ana')
    // Only my messages can be deleted
    expect(screen.getAllByRole('button', { name: /^Delete message/ })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Delete message: Hello Ana' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(within(log).queryByText('Hello Ana')).not.toBeInTheDocument())
    expect(within(log).getByText('Hi there')).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([url, init]) => init?.method === 'DELETE' && String(url).endsWith('/1')),
    ).toBe(true)
  })

  it('opens on the right chat from a link in the email notice', async () => {
    let people = [STRANGER]
    const fetchMock = mockApi({
      ...ME,
      [PEOPLE]: () => ({ body: { items: people } }),
      'GET /api/messenger/messages?with=new%40example.com': { body: { items: [STRANGER.last] } },
      'POST /api/recipients': () => {
        people = [{ ...STRANGER, name: 'new', recipient_id: 7, unread: 0 }]
        return { status: 201, body: { id: 7 } }
      },
    })
    renderShell('/messenger?with=New@example.com')
    const user = userEvent.setup()

    // The panel is open on that chat, over the home page
    const panel = await screen.findByRole('complementary', { name: 'Messenger' })
    const log = await within(panel).findByRole('log')
    expect(await within(log).findByText('Do you remember me?')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Welcome' })).toBeInTheDocument()

    // Someone who wrote first can be added to the recipients
    await user.click(within(panel).getByRole('button', { name: 'Add to recipients' }))
    expect(await screen.findByRole('region', { name: 'Chat with new' })).toBeInTheDocument()
    expect(lastBody(fetchMock, 'POST /api/recipients')).toMatchObject({
      first_name: 'new',
      email: 'new@example.com',
    })
    expect(screen.queryByRole('button', { name: 'Add to recipients' })).not.toBeInTheDocument()
  })

  it('explains when the address is not someone I can chat with', async () => {
    mockApi({ ...ME, [PEOPLE]: { body: { items: [BOB] } } })
    renderShell('/messenger?with=who@example.com')

    expect(await screen.findByText(/who@example.com is not one of your recipients/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('points to Recipients when there is nobody to chat with', async () => {
    mockApi({ ...ME, [PEOPLE]: { body: { items: [] } } })
    renderShell()

    const panel = await openPanel()
    expect(await within(panel).findByText(/No one to chat with yet/)).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'Recipients' })).toHaveAttribute('href', '/recipients')
  })

  it('shows the error when the chats cannot be loaded', async () => {
    mockApi({ ...ME, [PEOPLE]: { status: 500, body: { error: 'Server is down.' } } })
    renderShell()

    const panel = await openPanel()
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Server is down.')
  })

  it('opens from the apps menu and the home tile without leaving the page', async () => {
    mockApi({ ...ME, [PEOPLE]: { body: { items: [BOB] } } })
    renderShell()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Apps' }))
    await user.click(screen.getByRole('link', { name: 'Messenger' }))
    expect(screen.getByRole('complementary', { name: 'Messenger' })).toBeInTheDocument()
    expect(screen.getByText('drive page')).toBeInTheDocument()
  })

  it('opens the chat with a recipient from the Recipients page', async () => {
    mockApi({
      ...ME,
      'GET /api/recipients': {
        body: {
          items: [
            { id: 1, first_name: 'Ana', last_name: 'Kovač', email: 'ana@example.com', address: '', country: '', mobile: '' },
          ],
        },
      },
      [PEOPLE]: { body: { items: [ANA] } },
      [CHAT_ANA]: { body: { items: [HELLO] } },
    })
    renderShell('/recipients')

    await userEvent.click(await screen.findByRole('button', { name: 'Message Ana Kovač' }))
    const chat = await screen.findByRole('region', { name: 'Chat with Ana Kovač' })
    expect(await within(chat).findByText('Hello Ana')).toBeInTheDocument()
    // Still on the Recipients page
    expect(screen.getByRole('heading', { name: 'Recipients' })).toBeInTheDocument()
  })
})
