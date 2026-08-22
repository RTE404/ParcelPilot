import { describe, it, expect } from 'vitest'
import { classifySeverity, calculateSlaStatus } from '../slaStatus'
import type { Ticket, Account } from '@/lib/data/types'

const NOW = '2026-08-16T11:00:00+05:30'

function ticket(overrides: Partial<Ticket>): Ticket {
  return {
    ticketId: 'TKT-TEST', accountId: 'ACCT-003', createdAt: '2026-08-16T10:00:00+05:30', status: 'open',
    subject: '', description: '', channel: 'email', assignedTo: 'Rohit', lastCustomerMessageAt: '2026-08-16T10:00:00+05:30',
    historicalResolution: null, ...overrides,
  }
}

function account(overrides: Partial<Account>): Account {
  return { accountId: 'ACCT-003', accountName: 'Beacon Retail', plan: 'Standard', status: 'active', csm: 'Neha Kapoor', contractFile: null, premiumSupport: false, ...overrides }
}

describe('classifySeverity', () => {
  it('classifies a credential-exposure ticket as P1', () => {
    expect(classifySeverity(ticket({ subject: 'Possible API key exposure', description: 'a production API key leaked' }))).toBe('P1')
  })

  it('classifies a total shipment-creation outage as P1', () => {
    expect(classifySeverity(ticket({ subject: 'All shipment creation is failing', description: 'HTTP 500 for everyone' }))).toBe('P1')
  })

  it('classifies a routine question as P3', () => {
    expect(classifySeverity(ticket({ subject: 'How do we change the billing contact?' }))).toBe('P3')
  })
})

describe('calculateSlaStatus', () => {
  it('detects Northstar\'s P1 SLA already breached at the reference time', () => {
    const t = ticket({ accountId: 'ACCT-001', createdAt: '2026-08-16T10:30:00+05:30', subject: 'All shipment creation is failing' })
    const result = calculateSlaStatus(t, account({ accountId: 'ACCT-001', plan: 'Enterprise' }), NOW)
    expect(result.severity).toBe('P1')
    expect(result.breached).toBe(true)
    expect(result.elapsedMinutes).toBe(30)
    expect(result.targetMinutes).toBe(15)
  })

  it('uses the Enterprise default P1 target (30 minutes) when no contract override exists', () => {
    const t = ticket({ accountId: 'ACCT-004', createdAt: '2026-08-16T10:40:00+05:30', subject: 'API key exposure' })
    const result = calculateSlaStatus(t, account({ accountId: 'ACCT-004', plan: 'Enterprise' }), NOW)
    expect(result.targetMinutes).toBe(30)
    expect(result.breached).toBe(false) // 20 minutes elapsed, under 30
  })
})
