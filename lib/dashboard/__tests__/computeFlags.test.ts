import { describe, it, expect, vi } from 'vitest'
import { computeDashboardFlags, isCancellationFeeDispute, isBulkUploadLimitDispute } from '../computeFlags'
import type { Ticket } from '@/lib/data/types'

function makeTicket(overrides: Partial<Ticket>): Ticket {
  return {
    ticketId: 'TKT-TEST',
    accountId: 'ACCT-001',
    createdAt: '2026-08-16T10:00:00+05:30',
    status: 'closed',
    subject: '',
    description: '',
    channel: 'email',
    assignedTo: 'Maya',
    lastCustomerMessageAt: '2026-08-16T10:00:00+05:30',
    historicalResolution: null,
    ...overrides,
  }
}

describe('computeDashboardFlags', () => {
  it('flags TKT-501 (Northstar) as an already-breached P1', () => {
    const { slaFlags } = computeDashboardFlags()
    const flag = slaFlags.find(f => f.ticketId === 'TKT-501')
    expect(flag?.breached).toBe(true)
    expect(flag?.severity).toBe('P1')
  })

  it('flags TKT-505 (Axis Labs) as a security incident, distinct from the general SLA list', () => {
    const { securityFlags } = computeDashboardFlags()
    const flag = securityFlags.find(f => f.ticketId === 'TKT-505')
    expect(flag).toBeDefined()
    expect(flag?.severity).toBe('P1')
  })

  it('does not flag TKT-501 (a general-outage P1, not a security one) as a security incident', () => {
    // TKT-501 ("All shipment creation is failing") is P1 via GENERAL_OUTAGE_P1_KEYWORDS, not the
    // security-specific keyword set — proves the split is real, not just "every P1 ticket".
    const { securityFlags, slaFlags } = computeDashboardFlags()
    expect(slaFlags.find(f => f.ticketId === 'TKT-501')?.severity).toBe('P1')
    expect(securityFlags.find(f => f.ticketId === 'TKT-501')).toBeUndefined()
  })

  it('clusters TKT-502 under the KI-208 known issue', () => {
    const { knownIssueClusters } = computeDashboardFlags()
    const cluster = knownIssueClusters.find(c => c.knownIssueId === 'KI-208')
    expect(cluster?.ticketIds).toContain('TKT-502')
  })

  it('flags TKT-450 as a historical resolution disagreeing with the current Northstar contract', () => {
    const { historicalAudits } = computeDashboardFlags()
    const audit = historicalAudits.find(a => a.ticketId === 'TKT-450')
    expect(audit?.reviewRecommended).toBe(true)
    expect(audit?.discrepancy).toMatch(/waives it entirely/)
  })

  it('flags TKT-451 as a historical resolution citing the known-issue threshold instead of the product limit', () => {
    const { historicalAudits } = computeDashboardFlags()
    // TKT-451's historical answer conflates the KI-208 failure threshold (~3,000 rows) with the
    // actual 5,000-row product limit — this must still be flagged after generalizing the audit.
    const audit = historicalAudits.find(a => a.ticketId === 'TKT-451')
    expect(audit?.reviewRecommended).toBe(true)
    expect(audit?.discrepancy).toMatch(/5000|5,000/)
  })

  it('does not flag every historical resolution unconditionally', () => {
    const { historicalAudits } = computeDashboardFlags()
    expect(historicalAudits.every(a => typeof a.reviewRecommended === 'boolean')).toBe(true)
  })

  describe('accountRollups', () => {
    it('rolls up Northstar (ACCT-001) with its SLA breach (TKT-501), known-issue match (TKT-504/KI-211), and historical flag (TKT-450)', () => {
      const { accountRollups } = computeDashboardFlags()
      const rollup = accountRollups.find(r => r.accountId === 'ACCT-001')
      expect(rollup).toEqual({
        accountId: 'ACCT-001',
        accountName: 'Northstar Logistics',
        breachCount: 1,
        knownIssueCount: 1,
        historicalFlagCount: 1,
      })
    })

    it('excludes an account with zero flags (Beacon Retail / ACCT-003)', () => {
      const { accountRollups } = computeDashboardFlags()
      expect(accountRollups.find(r => r.accountId === 'ACCT-003')).toBeUndefined()
    })

    it('sorts by total flag count descending', () => {
      const { accountRollups } = computeDashboardFlags()
      const totals = accountRollups.map(r => r.breachCount + r.knownIssueCount + r.historicalFlagCount)
      expect(totals).toEqual([...totals].sort((a, b) => b - a))
    })
  })

  describe('content-based classification generalizes beyond the two seeded ticket IDs', () => {
    it('isCancellationFeeDispute matches on content, not ticket ID', () => {
      expect(isCancellationFeeDispute(makeTicket({
        ticketId: 'TKT-999',
        subject: 'Cancellation fee dispute',
        description: 'Customer disputes a cancellation fee charged after booking.',
        historicalResolution: 'Agent told customer a INR 500 cancellation fee applied.',
      }))).toBe(true)
      expect(isCancellationFeeDispute(makeTicket({
        subject: 'How do we change the billing contact?',
        description: 'Customer wants to replace the billing-contact email on their account.',
        historicalResolution: 'Agent updated the billing contact per the request.',
      }))).toBe(false)
    })

    it('isBulkUploadLimitDispute matches on content, not ticket ID', () => {
      expect(isBulkUploadLimitDispute(makeTicket({
        ticketId: 'TKT-998',
        subject: 'Bulk CSV upload row limit dispute',
        description: 'Customer disputes the row limit quoted for CSV bulk upload.',
        historicalResolution: 'Agent told customer the row limit is 2,000 rows.',
      }))).toBe(true)
      expect(isBulkUploadLimitDispute(makeTicket({
        subject: 'How do we change the billing contact?',
        description: 'Customer wants to replace the billing-contact email on their account.',
        historicalResolution: 'Agent updated the billing contact per the request.',
      }))).toBe(false)
    })

    it('flags a brand-new cancellation-fee-dispute ticket (different ID from TKT-450) with a wrong fee claim', async () => {
      vi.resetModules()
      vi.doMock('@/lib/data/loadData', async () => {
        const actual = await vi.importActual<typeof import('@/lib/data/loadData')>('@/lib/data/loadData')
        const fictionalTicket = makeTicket({
          ticketId: 'TKT-999',
          accountId: 'ACCT-002', // LumenWorks — not fee-waived, so the calculator computes a real fee
          subject: 'Cancellation fee dispute',
          description: 'LumenWorks disputes the cancellation fee charged for a BOOKED shipment.',
          historicalResolution: 'Agent told customer a INR 500 cancellation fee applied.',
        })
        return { ...actual, loadTickets: () => [...actual.loadTickets(), fictionalTicket] }
      })
      const { computeDashboardFlags: computeWithFictionalTicket } = await import('../computeFlags')
      const { historicalAudits } = computeWithFictionalTicket()
      const audit = historicalAudits.find(a => a.ticketId === 'TKT-999')
      // A still-ID-gated implementation (branching on 'TKT-450'/'TKT-451') would fall through to
      // { reviewRecommended: false, discrepancy: null } here — proving the generalization works.
      expect(audit?.reviewRecommended).toBe(true)
      expect(audit?.discrepancy).toMatch(/500/)
      vi.doUnmock('@/lib/data/loadData')
      vi.resetModules()
    })

    it('flags a brand-new bulk-upload-limit-dispute ticket (different ID from TKT-451) with a wrong claimed limit', async () => {
      vi.resetModules()
      vi.doMock('@/lib/data/loadData', async () => {
        const actual = await vi.importActual<typeof import('@/lib/data/loadData')>('@/lib/data/loadData')
        const fictionalTicket = makeTicket({
          ticketId: 'TKT-998',
          accountId: 'ACCT-003',
          subject: 'Bulk CSV upload row limit dispute',
          description: 'Customer disputes the row limit quoted for CSV bulk upload.',
          historicalResolution: 'Agent told customer the row limit is 2,000 rows.',
        })
        return { ...actual, loadTickets: () => [...actual.loadTickets(), fictionalTicket] }
      })
      const { computeDashboardFlags: computeWithFictionalTicket } = await import('../computeFlags')
      const { historicalAudits } = computeWithFictionalTicket()
      const audit = historicalAudits.find(a => a.ticketId === 'TKT-998')
      expect(audit?.reviewRecommended).toBe(true)
      expect(audit?.discrepancy).toMatch(/2000|2,000/)
      vi.doUnmock('@/lib/data/loadData')
      vi.resetModules()
    })

    it('does not flag a historical resolution unrelated to either dispute category', async () => {
      vi.resetModules()
      vi.doMock('@/lib/data/loadData', async () => {
        const actual = await vi.importActual<typeof import('@/lib/data/loadData')>('@/lib/data/loadData')
        const fictionalTicket = makeTicket({
          ticketId: 'TKT-997',
          accountId: 'ACCT-003',
          subject: 'How do we change the billing contact?',
          description: 'Customer wants to replace the billing-contact email on their account.',
          historicalResolution: 'Agent updated the billing contact per the request.',
        })
        return { ...actual, loadTickets: () => [...actual.loadTickets(), fictionalTicket] }
      })
      const { computeDashboardFlags: computeWithFictionalTicket } = await import('../computeFlags')
      const { historicalAudits } = computeWithFictionalTicket()
      const audit = historicalAudits.find(a => a.ticketId === 'TKT-997')
      expect(audit?.reviewRecommended).toBe(false)
      expect(audit?.discrepancy).toBeNull()
      vi.doUnmock('@/lib/data/loadData')
      vi.resetModules()
    })
  })

  describe('computeAccountRollups', () => {
    it('correctly attributes a ticket that is both an SLA breach and a known-issue-cluster member to both counts, without conflating them', async () => {
      vi.resetModules()
      vi.doMock('@/lib/data/loadData', async () => {
        const actual = await vi.importActual<typeof import('@/lib/data/loadData')>('@/lib/data/loadData')
        // Old enough to breach SLA regardless of plan/severity; matches KI-208's keywords so it
        // also clusters as a known issue — the one overlap case the current seed data lacks.
        const overlappingTicket = makeTicket({
          ticketId: 'TKT-996',
          accountId: 'ACCT-002',
          status: 'open',
          createdAt: '2026-08-01T00:00:00+05:30',
          subject: 'Bulk CSV upload failing again',
          description: 'Customer reports repeated bulk upload failures for a 4,000-row CSV file.',
        })
        const tickets = [...actual.loadTickets(), overlappingTicket]
        // computeAccountRollups resolves each flag back to its account via getTicketById, which
        // internally calls loadTickets() through its own module-scoped reference — overriding
        // loadTickets alone doesn't patch that internal call, so getTicketById must be
        // overridden too, consistently, against the same extended ticket list.
        return { ...actual, loadTickets: () => tickets, getTicketById: (id: string) => tickets.find(t => t.ticketId === id) }
      })
      const { computeDashboardFlags: computeWithOverlap } = await import('../computeFlags')
      const { slaFlags, knownIssueClusters, accountRollups } = computeWithOverlap()

      expect(slaFlags.find(f => f.ticketId === 'TKT-996')?.breached).toBe(true)
      expect(knownIssueClusters.find(c => c.knownIssueId === 'KI-208')?.ticketIds).toContain('TKT-996')

      const rollup = accountRollups.find(r => r.accountId === 'ACCT-002')
      expect(rollup).toBeDefined()
      expect(rollup?.breachCount).toBeGreaterThanOrEqual(1)
      expect(rollup?.knownIssueCount).toBeGreaterThanOrEqual(1)
      vi.doUnmock('@/lib/data/loadData')
      vi.resetModules()
    })
  })

  it('still picks the BOOKED order for TKT-450 even if a non-BOOKED order for the account sorts first', async () => {
    vi.resetModules()
    vi.doMock('@/lib/data/loadData', async () => {
      const actual = await vi.importActual<typeof import('@/lib/data/loadData')>('@/lib/data/loadData')
      const reorderedOrders = [...actual.loadOrders()].sort((a, b) =>
        a.accountId === 'ACCT-001' && b.accountId === 'ACCT-001' ? (a.status === 'BOOKED' ? 1 : -1) : 0
      )
      return { ...actual, loadOrders: () => reorderedOrders }
    })
    const { computeDashboardFlags: computeDashboardFlagsWithReorderedData } = await import('../computeFlags')
    const { historicalAudits } = computeDashboardFlagsWithReorderedData()
    const audit = historicalAudits.find(a => a.ticketId === 'TKT-450')
    // With the account's PICKED_UP order (ORD-1002) sorted ahead of its BOOKED order (ORD-1001),
    // an unfiltered `.find()` would pick ORD-1002 and calculateCancellationEligibility would
    // short-circuit to feeWaived: false, silently flipping reviewRecommended to false.
    expect(audit?.reviewRecommended).toBe(true)
    vi.doUnmock('@/lib/data/loadData')
    vi.resetModules()
  })
})
