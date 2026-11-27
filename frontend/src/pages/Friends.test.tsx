import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { USER, lastBody, mockApi, renderApp } from '../test/utils'
import Friends from './Friends'

const ANA = {
  id: 1,
  first_name: 'Ana',
  last_name: 'Kovač',
  email: 'ana@example.com',
  address: 'Main Street 1',
  country: 'Serbia',
  mobile: '+381 60 123',
}

const ME = { 'GET /api/auth/me': { body: { user: USER } } }

describe('Friends', () => {
  it('lists friends with all six fields', async () => {
    mockApi({ ...ME, 'GET /api/friends': { body: { items: [ANA] } } })
    renderApp(<Friends />)

    const row = (await screen.findByText('ana@example.com')).closest('tr')!
    for (const value of ['Ana', 'Kovač', 'Main Street 1', 'Serbia', '+381 60 123']) {
      expect(within(row).getByText(value)).toBeInTheDocument()
    }
    expect(
      screen.getAllByRole('columnheader').map((th) => th.textContent).slice(0, 6),
    ).toEqual(['First name', 'Last name', 'Email', 'Address', 'Country', 'Mobile'])
  })

  it('can show friends as a grid of cards', async () => {
    mockApi({ ...ME, 'GET /api/friends': { body: { items: [ANA] } } })
    renderApp(<Friends />)
    const user = userEvent.setup()

    await screen.findByText('ana@example.com')
    await user.click(screen.getByRole('button', { name: 'Grid view' }))

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    const card = screen.getByRole('listitem', { name: 'Ana Kovač' })
    expect(within(card).getByRole('link', { name: 'ana@example.com' })).toHaveAttribute(
      'href',
      'mailto:ana@example.com',
    )
    expect(within(card).getByText('Main Street 1, Serbia')).toBeInTheDocument()
    expect(within(card).getByText('+381 60 123')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Edit Ana Kovač' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'List view' }))
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    mockApi({ ...ME, 'GET /api/friends': { body: { items: [] } } })
    renderApp(<Friends />)
    expect(await screen.findByText(/No friends yet/)).toBeInTheDocument()
  })

  it('adds a friend', async () => {
    const items: (typeof ANA)[] = []
    const fetchMock = mockApi({
      ...ME,
      'GET /api/friends': () => ({ body: { items } }),
      'POST /api/friends': (body) => {
        items.push({ ...(body as typeof ANA), id: 1 })
        return { status: 201, body: items[0] }
      },
    })
    renderApp(<Friends />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'New friend' }))
    const dialog = screen.getByRole('dialog', { name: 'New friend' })
    await user.type(within(dialog).getByLabelText('First name'), 'Ana')
    await user.type(within(dialog).getByLabelText('Last name'), 'Kovač')
    await user.type(within(dialog).getByLabelText('Email'), 'ana@example.com')
    await user.type(within(dialog).getByLabelText('Address'), 'Main Street 1')
    await user.type(within(dialog).getByLabelText('Country'), 'Serbia')
    await user.type(within(dialog).getByLabelText('Mobile'), '+381 60 123')
    await user.click(within(dialog).getByRole('button', { name: 'Add friend' }))

    expect(await screen.findByText('ana@example.com')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(lastBody(fetchMock, 'POST /api/friends')).toEqual({
      first_name: 'Ana',
      last_name: 'Kovač',
      email: 'ana@example.com',
      address: 'Main Street 1',
      country: 'Serbia',
      mobile: '+381 60 123',
    })
  })

  it('keeps the dialog open and shows the server error', async () => {
    mockApi({
      ...ME,
      'GET /api/friends': { body: { items: [ANA] } },
      'PATCH /api/friends/1': {
        status: 409,
        body: { error: 'A friend with this email address already exists.' },
      },
    })
    renderApp(<Friends />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Edit Ana Kovač' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit friend' })
    expect(within(dialog).getByLabelText('Country')).toHaveValue('Serbia')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('already exists')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('deletes a friend after confirmation', async () => {
    let items = [ANA]
    const fetchMock = mockApi({
      ...ME,
      'GET /api/friends': () => ({ body: { items } }),
      'DELETE /api/friends/1': () => {
        items = []
        return { status: 204 }
      },
    })
    renderApp(<Friends />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Delete Ana Kovač' }))
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText(/No friends yet/)).toBeInTheDocument()
  })
})
