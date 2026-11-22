import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { USER, mockApi, renderApp } from '../test/utils'
import AppLayout from './AppLayout'

function renderLayout(route = '/') {
  mockApi({ 'GET /api/auth/me': { body: { user: USER } } })
  return renderApp(
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<p>home page</p>} />
        <Route path="/drive" element={<p>drive page</p>} />
        <Route path="/recipients" element={<p>recipients page</p>} />
      </Route>
    </Routes>,
    route,
  )
}

describe('AppLayout', () => {
  it('has an apps menu next to the account button, listing every app with an icon', async () => {
    renderLayout()
    const apps = await screen.findByRole('button', { name: 'Apps' })
    const account = screen.getByRole('button', { name: 'Account' })
    // The apps button comes right before the profile button in the header
    expect(apps.closest('.header-menu')?.nextElementSibling).toBe(account.closest('.header-menu'))

    expect(screen.queryByRole('navigation', { name: 'Apps' })).not.toBeInTheDocument()
    await userEvent.click(apps)

    const links = within(screen.getByRole('navigation', { name: 'Apps' })).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
      'Drive',
      'Photos',
      'Tasks',
      'Calendar',
      'Recipients',
    ])
    for (const link of links) expect(link.querySelector('svg')).not.toBeNull()
  })

  it('opens the chosen app and closes the menu', async () => {
    renderLayout()
    await userEvent.click(await screen.findByRole('button', { name: 'Apps' }))
    await userEvent.click(screen.getByRole('link', { name: 'Recipients' }))

    expect(screen.getByText('recipients page')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Apps' })).not.toBeInTheDocument()
  })

  it('marks the current app in the menu and shows it in the header', async () => {
    renderLayout('/drive')
    await userEvent.click(await screen.findByRole('button', { name: 'Apps' }))
    expect(screen.getByRole('link', { name: 'Drive' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Photos' })).not.toHaveAttribute('aria-current')
  })

  it('closes the menu on Escape and on a click outside', async () => {
    renderLayout()
    const apps = await screen.findByRole('button', { name: 'Apps' })

    await userEvent.click(apps)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('navigation', { name: 'Apps' })).not.toBeInTheDocument()

    await userEvent.click(apps)
    await userEvent.click(screen.getByText('home page'))
    expect(screen.queryByRole('navigation', { name: 'Apps' })).not.toBeInTheDocument()
  })

  it('shows the signed-in email in the account menu', async () => {
    renderLayout()
    await userEvent.click(await screen.findByRole('button', { name: 'Account' }))
    expect(screen.getByText('user@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })
})
