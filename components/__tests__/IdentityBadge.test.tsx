import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IdentityBadge } from '../IdentityBadge'

describe('IdentityBadge', () => {
  it('shows the current identity name and sublabel', () => {
    render(<IdentityBadge name="Priya Mehta" sublabel="Manager" switchHref="/internal/login" />)
    expect(screen.getByText('Priya Mehta')).toBeInTheDocument()
    expect(screen.getByText('Manager')).toBeInTheDocument()
  })

  it('renders a switch-identity link pointing at the given href', () => {
    render(<IdentityBadge name="Rohit" sublabel="Support Agent" switchHref="/internal/login" />)
    expect(screen.getByRole('link', { name: /switch/i })).toHaveAttribute('href', '/internal/login')
  })
})
