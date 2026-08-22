interface ActionLogEntry {
  accountId: string
  type: 'credit' | 'escalation' | 'ticket_update' | 'followup'
  amountInr?: number
  createdAt: string
}

let log: ActionLogEntry[] = []

export function recordAction(entry: ActionLogEntry): void {
  log.push(entry)
}

export function getMonthlyCreditsForAccount(accountId: string): number {
  return log.filter(e => e.accountId === accountId && e.type === 'credit').reduce((sum, e) => sum + (e.amountInr ?? 0), 0)
}

/** Test-only: reset the in-memory log between test cases. */
export function resetActionLog(): void {
  log = []
}
