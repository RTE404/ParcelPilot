import { REFERENCE_NOW } from '@/lib/data/loadData'

interface ActionLogEntry {
  accountId: string
  type: 'credit' | 'escalation' | 'ticket_update' | 'followup'
  amountInr?: number
  createdAt: string
}

// Demo-only seed: "credits already issued this month" for Northstar (ACCT-001, which has a real
// ₹5,000 monthly cap — see lib/data/contractRules.ts), dated within REFERENCE_NOW's month, so a
// fresh demo session can plausibly trip EXCEEDS_APPROVAL_LIMIT on a new credit approval instead
// of always starting from zero. This app has no real persistence layer anywhere else either — a
// static seed matches the rest of the dataset's demo-fixture spirit. resetActionLog() (used by
// tests) intentionally resets to an empty array, not back to this seed, so seeded state never
// leaks into test isolation.
const SEED_LOG: ActionLogEntry[] = [
  { accountId: 'ACCT-001', type: 'credit', amountInr: 3200, createdAt: REFERENCE_NOW },
  { accountId: 'ACCT-001', type: 'credit', amountInr: 1500, createdAt: REFERENCE_NOW },
]

let log: ActionLogEntry[] = [...SEED_LOG]

export function recordAction(entry: ActionLogEntry): void {
  log.push(entry)
}

export function getMonthlyCreditsForAccount(accountId: string): number {
  const currentMonth = REFERENCE_NOW.slice(0, 7)
  return log
    .filter(e => e.accountId === accountId && e.type === 'credit' && e.createdAt.slice(0, 7) === currentMonth)
    .reduce((sum, e) => sum + (e.amountInr ?? 0), 0)
}

/** Test-only: reset the in-memory log to empty between test cases (deliberately not re-seeded — see SEED_LOG comment above). */
export function resetActionLog(): void {
  log = []
}
