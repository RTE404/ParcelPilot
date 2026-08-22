import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ToolActivityIndicator } from '../ToolActivityIndicator'

describe('ToolActivityIndicator', () => {
  it('shows a running state for an in-progress tool call', () => {
    render(<ToolActivityIndicator toolName="searchDocuments" state="input-available" />)
    expect(screen.getByText(/searching documents/i)).toBeInTheDocument()
  })

  it('shows a completed state once output is available', () => {
    render(<ToolActivityIndicator toolName="calculateServiceCredit" state="output-available" />)
    expect(screen.getByText(/calculated service credit/i)).toBeInTheDocument()
  })
})
