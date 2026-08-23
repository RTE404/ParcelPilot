import { describe, it, expect, vi } from 'vitest'
import type { Ticket, Account, ContractRule } from '@/lib/data/types'

// I5 / M9: both real accounts (ACCT-001, ACCT-002) currently define an SLA override for every
// severity, so the "overrideLabel is falsy" and "overrideLabel doesn't resolve to a known
// duration" branches can't be exercised with real data alone — that's exactly the gap that let
// the bugs exist. Mock the contract-rules module so a couple of synthetic accounts can exercise
// those branches, while every other account still resolves through the real dataset.
const SYNTHETIC_RULES: Record<string, ContractRule> = {
  'ACCT-SYNTH-NO-OVERRIDE': {
    accountId: 'ACCT-SYNTH-NO-OVERRIDE',
    sourceDoc: '99_Synthetic_Agreement.pdf',
    sourceSection: '1',
    slaOverrides: null,
    cancellationFeeWaived: false,
    cancellationFeeGraceMinutes: null,
    cancellationFeeAmountInr: null,
    creditDelayThresholdHours: null,
    creditAmountInr: null,
    creditMonthlyCapInr: null,
  },
  'ACCT-SYNTH-UNKNOWN-OVERRIDE': {
    accountId: 'ACCT-SYNTH-UNKNOWN-OVERRIDE',
    sourceDoc: '99_Synthetic_Agreement.pdf',
    sourceSection: '1',
    slaOverrides: { P1: '99x', P2: '99x', P3: '99x' },
    cancellationFeeWaived: false,
    cancellationFeeGraceMinutes: null,
    cancellationFeeAmountInr: null,
    creditDelayThresholdHours: null,
    creditAmountInr: null,
    creditMonthlyCapInr: null,
  },
}

vi.mock('@/lib/data/contractRules', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/data/contractRules')>()
  return {
    ...actual,
    getContractRule: (accountId: string) => SYNTHETIC_RULES[accountId] ?? actual.getContractRule(accountId),
  }
})

import { classifySeverity, calculateSlaStatus } from '../slaStatus'

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

  // I5: citation must be gated on the value actually used (a resolved override), not merely on
  // whether a contract rule object exists — a synthetic account is needed because both real
  // accounts define an override for every severity.
  it('cites the policy default, not the contract, when the contract rule exists but has no SLA override for this severity', () => {
    const t = ticket({ accountId: 'ACCT-SYNTH-NO-OVERRIDE', createdAt: '2026-08-16T10:40:00+05:30', subject: 'API key exposure' })
    const result = calculateSlaStatus(t, account({ accountId: 'ACCT-SYNTH-NO-OVERRIDE', plan: 'Enterprise' }), NOW)
    expect(result.severity).toBe('P1')
    expect(result.targetMinutes).toBe(30) // Enterprise P1 default
    expect(result.targetLabel).toBe('30m (policy default)')
    expect(result.citation).toBe('01_Support_Policy_v3_CURRENT.pdf, Section 3')
  })

  // M9: an override label that doesn't resolve to a known duration must fail closed (behave
  // exactly like "no override"), not silently produce `undefined`/NaN and mark the ticket
  // not-breached via `elapsedMinutes > undefined` evaluating to false.
  it('falls back to the plan default target and cites the policy doc when the SLA override label is unrecognized', () => {
    const t = ticket({ accountId: 'ACCT-SYNTH-UNKNOWN-OVERRIDE', createdAt: '2026-08-16T09:00:00+05:30', subject: 'API key exposure' })
    const result = calculateSlaStatus(t, account({ accountId: 'ACCT-SYNTH-UNKNOWN-OVERRIDE', plan: 'Enterprise' }), NOW)
    expect(result.severity).toBe('P1')
    expect(result.elapsedMinutes).toBe(120) // 2h elapsed, well past the 30m default -> must be flagged
    expect(result.targetMinutes).toBe(30) // Enterprise P1 default, not NaN/undefined
    expect(result.targetLabel).toBe('30m (policy default)')
    expect(result.breached).toBe(true)
    expect(result.citation).toBe('01_Support_Policy_v3_CURRENT.pdf, Section 3')
  })
})
