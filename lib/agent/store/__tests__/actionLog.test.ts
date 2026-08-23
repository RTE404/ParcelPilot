import { describe, it, expect, beforeEach } from 'vitest'
import { recordAction, getMonthlyCreditsForAccount, resetActionLog } from '../actionLog'
import { REFERENCE_NOW } from '@/lib/data/loadData'

// REFERENCE_NOW is 2026-08-16T... — an in-month entry shares that YYYY-MM prefix.
const OUT_OF_MONTH_DATE = '2026-07-15T09:00:00+05:30'

describe('actionLog store', () => {
  // resetActionLog() deliberately resets to an empty array, not back to the module's demo seed
  // (see the SEED_LOG comment in actionLog.ts) — this keeps every seeded/demo credit out of
  // test isolation, so each test below starts from a clean, known state.
  beforeEach(() => resetActionLog())

  it('getMonthlyCreditsForAccount excludes an entry whose createdAt falls in a different month from REFERENCE_NOW', () => {
    recordAction({ accountId: 'ACCT-999', type: 'credit', amountInr: 400, createdAt: OUT_OF_MONTH_DATE })
    recordAction({ accountId: 'ACCT-999', type: 'credit', amountInr: 100, createdAt: REFERENCE_NOW })

    // Only the in-month entry (100) should count — proves the filter actually filters by month,
    // not just summing every credit ever recorded regardless of date.
    expect(getMonthlyCreditsForAccount('ACCT-999')).toBe(100)
  })

  it('sums multiple in-month credit entries for the same account', () => {
    recordAction({ accountId: 'ACCT-999', type: 'credit', amountInr: 200, createdAt: REFERENCE_NOW })
    recordAction({ accountId: 'ACCT-999', type: 'credit', amountInr: 300, createdAt: REFERENCE_NOW })

    expect(getMonthlyCreditsForAccount('ACCT-999')).toBe(500)
  })

  it('excludes non-credit entries (e.g. escalation) even when in-month', () => {
    recordAction({ accountId: 'ACCT-999', type: 'escalation', createdAt: REFERENCE_NOW })

    expect(getMonthlyCreditsForAccount('ACCT-999')).toBe(0)
  })

  it('excludes entries for a different account', () => {
    recordAction({ accountId: 'ACCT-OTHER', type: 'credit', amountInr: 999, createdAt: REFERENCE_NOW })

    expect(getMonthlyCreditsForAccount('ACCT-999')).toBe(0)
  })

  it('resetActionLog resets to an empty log, not back to the module\'s demo seed', () => {
    // Even though the module seeds ACCT-001 with demo credits at import time, resetActionLog()
    // (used by every other test file's beforeEach) must leave a genuinely empty log so tests
    // stay isolated from that seed.
    expect(getMonthlyCreditsForAccount('ACCT-001')).toBe(0)
  })
})
