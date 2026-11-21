import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { mockApi } from '../test/utils'
import DemoFetch from './DemoFetch'

const DEMO = {
  message: 'Hello, user@example.com!',
  server_time: '2026-11-21T18:00:00+00:00',
  items: [
    { id: 1, name: 'Cardboard box', size: 'small' },
    { id: 2, name: 'Wooden crate', size: 'medium' },
  ],
}

describe('DemoFetch', () => {
  it('shows loading, then the fetched data', async () => {
    mockApi({ 'GET /api/demo': { body: DEMO } })
    render(<DemoFetch />)

    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fetch again' })).toBeDisabled()

    expect(await screen.findByText('Hello, user@example.com!')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('Wooden crate')).toBeInTheDocument()
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
  })

  it('shows the error when the request fails', async () => {
    mockApi({ 'GET /api/demo': { status: 401, body: { error: 'Authentication required.' } } })
    render(<DemoFetch />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Authentication required.')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('fetches again on demand and shows the new data', async () => {
    let calls = 0
    const fetchMock = mockApi({
      'GET /api/demo': () => ({ body: { ...DEMO, message: `Response ${++calls}` } }),
    })
    render(<DemoFetch />)
    expect(await screen.findByText('Response 1')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Fetch again' }))

    expect(await screen.findByText('Response 2')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('recovers after an error when fetching again succeeds', async () => {
    let fail = true
    mockApi({
      'GET /api/demo': () =>
        fail ? { status: 500, body: { error: 'Server error.' } } : { body: DEMO },
    })
    render(<DemoFetch />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Server error.')

    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Fetch again' }))

    expect(await screen.findByText('Hello, user@example.com!')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
