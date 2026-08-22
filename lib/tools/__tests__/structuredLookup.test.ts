import { describe, it, expect } from 'vitest'
import { getOrder, getAccount, getTicket, listOpenTickets } from '../structuredLookup'
import type { SessionIdentity } from '@/lib/identity/types'

const northstarCustomer = { surface: 'customer' as const, accountId: 'ACCT-001' }
const lumenworksCustomer = { surface: 'customer' as const, accountId: 'ACCT-002' }
const internalStaff = { surface: 'internal' as const, staffId: 'rohit', role: 'support_agent' as const }

// A customer session with no accountId is now rejected by decodeSession (Layer 1), so this
// shape should never reach structuredLookup in practice. This proves the runtime guard here
// (Layer 2) independently fails closed if some future bug ever produced one anyway.
const brokenCustomerSession = { surface: 'customer' } as SessionIdentity

describe('structuredLookup', () => {
  it('returns an order belonging to the caller\'s own account', () => {
    const result = getOrder('ORD-1001', northstarCustomer)
    expect(result.found).toBe(true)
    if (result.found) expect(result.record.accountId).toBe('ACCT-001')
  })

  it('returns not-found for a customer requesting another account\'s order', () => {
    const result = getOrder('ORD-1001', lumenworksCustomer)
    expect(result.found).toBe(false)
  })

  it('returns not-found for a nonexistent order id', () => {
    expect(getOrder('ORD-9999', northstarCustomer).found).toBe(false)
  })

  it('lets an internal session fetch any order', () => {
    const result = getOrder('ORD-1001', internalStaff)
    expect(result.found).toBe(true)
  })

  it('forces the account filter for a customer session regardless of requested accountId', () => {
    const result = getAccount(northstarCustomer, 'ACCT-002')
    expect(result.found).toBe(true)
    if (result.found) expect(result.record.accountId).toBe('ACCT-001')
  })

  it('returns not-found for a customer fetching another account\'s ticket', () => {
    expect(getTicket('TKT-505', northstarCustomer).found).toBe(false) // TKT-505 belongs to Axis Labs
  })

  it('restricts listOpenTickets to the caller\'s account for a customer session', () => {
    const result = listOpenTickets(northstarCustomer)
    expect(result.every(t => t.accountId === 'ACCT-001')).toBe(true)
  })

  it('allows listOpenTickets across all accounts for an internal session', () => {
    const result = listOpenTickets(internalStaff)
    const accountIds = new Set(result.map(t => t.accountId))
    expect(accountIds.size).toBeGreaterThan(1)
  })

  it('fails closed on getOrder for a customer session with a missing accountId, rather than leaking every order', () => {
    const result = getOrder('ORD-1001', brokenCustomerSession)
    expect(result.found).toBe(false)
  })

  it('fails closed on getTicket for a customer session with a missing accountId, rather than leaking every ticket', () => {
    const result = getTicket('TKT-501', brokenCustomerSession)
    expect(result.found).toBe(false)
  })
})
