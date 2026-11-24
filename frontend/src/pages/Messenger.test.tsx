import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { ChatMessage, Conversation } from '../api'
import { USER, lastBody, mockApi, renderApp } from '../test/utils'
import Messenger from './Messenger'
import Recipients from './Recipients'

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

const CHAT_ANA = 'GET /api/messenger/messages?with=ana%40example.com'

function renderMessenger(route = '/messenger') {
  return renderApp(
    <Routes>
      <Route path="/messenger" element={<Messenger />} />
      <Route path="/recipients" element={<Recipients />} />
    </Routes>,
    route,
  )
}

describe('Messenger', () => {
  it('lists the recipients as people to chat with', async () => {
    mockApi({ ...ME, 'GET /api/messenger/conversations': { body: { items: [ANA, BOB] } } })
    renderMessenger()

    const chats = await screen.findByRole('navigation', { name: 'Chats' })
    const ana = within(chats).getByRole('link', { name: /Ana Kovač/ })
    expect(ana).toHaveAttribute('href', '/messenger?with=ana%40example.com')
    expect(within(ana).getByLabelText('1 unread')).toHaveTextContent('1')
    expect(ana).toHaveTextContent('Hi there')
    expect(within(chats).getByRole('link', { name: /Bob/ })).toHaveTextContent('No messages yet')
    expect(screen.getByText('Choose someone to chat with.')).toBeInTheDocument()
  })

  it('opens a chat and sends a message with Enter', async () => {
    let people = [ANA, BOB]
    const fetchMock = mockApi({
      ...ME,
      'GET /api/messenger/conversations': () => ({ body: { items: people } }),
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
    renderMessenger()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: /Ana Kovač/ }))
    const chat = await screen.findByRole('region', { name: 'Chat with Ana Kovač' })
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
    expect(screen.queryByLabelText('1 unread')).not.toBeInTheDocument()
  })

  it('keeps the text and shows the error when a message cannot be sent', async () => {
    mockApi({
      ...ME,
      'GET /api/messenger/conversations': { body: { items: [BOB] } },
      'GET /api/messenger/messages?with=bob%40example.com': { body: { items: [] } },
      'POST /api/messenger/messages': { status: 400, body: { error: 'Message is required.' } },
    })
    renderMessenger('/messenger?with=bob@example.com')
    const user = userEvent.setup()

    expect(await screen.findByText(/No messages yet. Write the first one/)).toBeInTheDocument()
    const box = screen.getByRole('textbox', { name: 'Message to Bob' })
    await user.type(box, 'Hello')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Message is required.')
    expect(box).toHaveValue('Hello')
  })

  it('deletes my own message after asking', async () => {
    const fetchMock = mockApi({
      ...ME,
      'GET /api/messenger/conversations': { body: { items: [ANA] } },
      [CHAT_ANA]: { body: { items: [HELLO, REPLY] } },
      'DELETE /api/messenger/messages/1': { status: 204 },
    })
    renderMessenger('/messenger?with=ana@example.com')
    const user = userEvent.setup()

    await screen.findByText('Hello Ana')
    // Only my messages can be deleted
    expect(screen.getAllByRole('button', { name: /^Delete message/ })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Delete message: Hello Ana' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    const log = screen.getByRole('log')
    await waitFor(() => expect(within(log).queryByText('Hello Ana')).not.toBeInTheDocument())
    expect(within(log).getByText('Hi there')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url, init]) => init?.method === 'DELETE' && String(url).endsWith('/1'))).toBe(true)
  })

  it('lets me add someone who wrote first to my recipients', async () => {
    let people = [STRANGER]
    const fetchMock = mockApi({
      ...ME,
      'GET /api/messenger/conversations': () => ({ body: { items: people } }),
      'GET /api/messenger/messages?with=new%40example.com': { body: { items: [STRANGER.last] } },
      'POST /api/recipients': () => {
        people = [{ ...STRANGER, name: 'new', recipient_id: 7, unread: 0 }]
        return { status: 201, body: { id: 7 } }
      },
    })
    renderMessenger('/messenger?with=new@example.com')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Add to recipients' }))

    expect(await screen.findByRole('region', { name: 'Chat with new' })).toBeInTheDocument()
    expect(lastBody(fetchMock, 'POST /api/recipients')).toMatchObject({
      first_name: 'new',
      email: 'new@example.com',
    })
    expect(screen.queryByRole('button', { name: 'Add to recipients' })).not.toBeInTheDocument()
  })

  it('explains when the address is not someone I can chat with', async () => {
    mockApi({ ...ME, 'GET /api/messenger/conversations': { body: { items: [BOB] } } })
    renderMessenger('/messenger?with=who@example.com')

    expect(await screen.findByText(/who@example.com is not one of your recipients/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('points to Recipients when there is nobody to chat with', async () => {
    mockApi({ ...ME, 'GET /api/messenger/conversations': { body: { items: [] } } })
    renderMessenger()

    expect(await screen.findByText(/No one to chat with yet/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Recipients' })).toHaveAttribute('href', '/recipients')
  })

  it('shows the error when the chats cannot be loaded', async () => {
    mockApi({ ...ME, 'GET /api/messenger/conversations': { status: 500, body: { error: 'Server is down.' } } })
    renderMessenger()
    expect(await screen.findByRole('alert')).toHaveTextContent('Server is down.')
  })

  it('is reachable from each recipient', async () => {
    mockApi({
      ...ME,
      'GET /api/recipients': {
        body: {
          items: [
            { id: 1, first_name: 'Ana', last_name: 'Kovač', email: 'ana@example.com', address: '', country: '', mobile: '' },
          ],
        },
      },
      'GET /api/messenger/conversations': { body: { items: [ANA] } },
      [CHAT_ANA]: { body: { items: [HELLO] } },
    })
    renderMessenger('/recipients')

    await userEvent.click(await screen.findByRole('link', { name: 'Message Ana Kovač' }))
    expect(await screen.findByRole('region', { name: 'Chat with Ana Kovač' })).toBeInTheDocument()
    expect(await screen.findByText('Hello Ana')).toBeInTheDocument()
  })
})
