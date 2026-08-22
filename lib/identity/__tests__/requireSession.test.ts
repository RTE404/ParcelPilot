import { describe, it, expect } from 'vitest'
import { isAllowed } from '../requireSession'

describe('isAllowed', () => {
  it('allows a customer session on the customer surface', () => {
    expect(isAllowed({ surface: 'customer', accountId: 'ACCT-001' }, 'customer')).toBe(true)
  })

  it('rejects a customer session on the internal surface', () => {
    expect(isAllowed({ surface: 'customer', accountId: 'ACCT-001' }, 'internal')).toBe(false)
  })

  it('rejects a null session', () => {
    expect(isAllowed(null, 'customer')).toBe(false)
  })
})
