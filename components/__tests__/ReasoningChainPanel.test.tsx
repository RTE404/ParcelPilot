import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReasoningChainPanel } from '../ReasoningChainPanel'

describe('ReasoningChainPanel', () => {
  it('is collapsed by default, showing a toggle', () => {
    render(<ReasoningChainPanel steps={[{ tool: 'getOrder', summary: 'Looked up ORD-1001' }]} />)
    expect(screen.queryByText('Looked up ORD-1001')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /show reasoning/i })).toBeInTheDocument()
  })

  it('expands to show every step when toggled', () => {
    render(<ReasoningChainPanel steps={[{ tool: 'getOrder', summary: 'Looked up ORD-1001' }, { tool: 'searchDocuments', summary: 'Found Northstar contract clause' }]} />)
    fireEvent.click(screen.getByRole('button', { name: /show reasoning/i }))
    expect(screen.getByText('Looked up ORD-1001')).toBeInTheDocument()
    expect(screen.getByText('Found Northstar contract clause')).toBeInTheDocument()
  })
})
