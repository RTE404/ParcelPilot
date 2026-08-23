import { loadTickets, loadOrders, getAccountById, getTicketById, REFERENCE_NOW } from '@/lib/data/loadData'
import type { Ticket } from '@/lib/data/types'
import { calculateSlaStatus, isSecurityIncident } from '@/lib/tools/calculations/slaStatus'
import { calculateCancellationEligibility } from '@/lib/tools/calculations/cancellationEligibility'
import { matchKnownIssue } from './knownIssues'

// Bulk Upload is documented (lib/data/documentChunks.ts) as supporting up to 5,000 rows per CSV.
// This is a structural product fact sourced from document content, not something re-parsed from
// prose on every audit — same pattern as knownIssues.ts's KNOWN_ISSUES table.
const PRODUCT_BULK_UPLOAD_ROW_LIMIT = 5000

const CANCELLATION_FEE_AMOUNT_PATTERN = /(?:INR|₹)\s*([\d,]+)/i
const BULK_UPLOAD_ROW_LIMIT_PATTERN = /([\d,]+)\s*rows?/i
// Same "digit near row(s)" shape as knownIssues.ts's ROW_COUNT_PATTERN, but used here purely to
// detect that a ticket is *about* a row count, not to extract the claimed number.
const ROW_COUNT_MENTION_PATTERN = /\d[\d,]*\s*-?\s*rows?\b/

function ticketText(t: Ticket): string {
  return `${t.subject} ${t.description} ${t.historicalResolution ?? ''}`.toLowerCase()
}

/** A cancellation-fee dispute: the ticket's content mentions both a cancellation and a fee. */
export function isCancellationFeeDispute(t: Ticket): boolean {
  const text = ticketText(t)
  const mentionsCancellation = text.includes('cancel')
  const mentionsFee = text.includes('fee') || CANCELLATION_FEE_AMOUNT_PATTERN.test(text)
  return mentionsCancellation && mentionsFee
}

/** A bulk-upload row-limit dispute: the ticket's content mentions bulk upload/CSV and a row count. */
export function isBulkUploadLimitDispute(t: Ticket): boolean {
  const text = ticketText(t)
  const mentionsBulkUpload = text.includes('csv') || text.includes('bulk upload')
  const mentionsRowCount = ROW_COUNT_MENTION_PATTERN.test(text)
  return mentionsBulkUpload && mentionsRowCount
}

export interface SlaFlag { ticketId: string; severity: string; breached: boolean; elapsedMinutes: number; targetMinutes: number }
export interface KnownIssueCluster { knownIssueId: string; ticketIds: string[]; accountIds: string[] }
export interface HistoricalAudit { ticketId: string; reviewRecommended: boolean; discrepancy: string | null }
export interface AccountRollup {
  accountId: string
  accountName: string
  breachCount: number
  knownIssueCount: number
  historicalFlagCount: number
}

export interface DashboardFlags {
  slaFlags: SlaFlag[]
  securityFlags: SlaFlag[]
  knownIssueClusters: KnownIssueCluster[]
  crossAccountImpacts: KnownIssueCluster[]
  historicalAudits: HistoricalAudit[]
  accountRollups: AccountRollup[]
}

function buildSlaFlag(t: Ticket): SlaFlag | null {
  const account = getAccountById(t.accountId)
  if (!account) return null
  const status = calculateSlaStatus(t, account, REFERENCE_NOW)
  return { ticketId: t.ticketId, severity: status.severity, breached: status.breached, elapsedMinutes: status.elapsedMinutes, targetMinutes: status.targetMinutes }
}

const byWorstOverrun = (a: SlaFlag, b: SlaFlag) => (b.elapsedMinutes - b.targetMinutes) - (a.elapsedMinutes - a.targetMinutes)

/**
 * Per-account rollup of SLA breach count + known-issue-cluster ticket count + flagged
 * historical-resolution discrepancy count — design spec §9's "needs attention" indicator.
 * Only accounts with at least one flag of any kind are included, sorted by total flag count
 * descending (most-in-need account first).
 */
function computeAccountRollups(slaFlags: SlaFlag[], knownIssueClusters: KnownIssueCluster[], historicalAudits: HistoricalAudit[]): AccountRollup[] {
  const counts = new Map<string, { breachCount: number; knownIssueCount: number; historicalFlagCount: number }>()
  const bump = (accountId: string, key: 'breachCount' | 'knownIssueCount' | 'historicalFlagCount') => {
    const entry = counts.get(accountId) ?? { breachCount: 0, knownIssueCount: 0, historicalFlagCount: 0 }
    entry[key] += 1
    counts.set(accountId, entry)
  }

  for (const f of slaFlags) {
    if (!f.breached) continue
    const ticket = getTicketById(f.ticketId)
    if (ticket) bump(ticket.accountId, 'breachCount')
  }
  for (const c of knownIssueClusters) {
    for (const ticketId of c.ticketIds) {
      const ticket = getTicketById(ticketId)
      if (ticket) bump(ticket.accountId, 'knownIssueCount')
    }
  }
  for (const a of historicalAudits) {
    if (!a.reviewRecommended) continue
    const ticket = getTicketById(a.ticketId)
    if (ticket) bump(ticket.accountId, 'historicalFlagCount')
  }

  return [...counts.entries()]
    .map(([accountId, c]) => ({ accountId, accountName: getAccountById(accountId)?.accountName ?? accountId, ...c }))
    .sort((a, b) => (b.breachCount + b.knownIssueCount + b.historicalFlagCount) - (a.breachCount + a.knownIssueCount + a.historicalFlagCount))
}

export function computeDashboardFlags(): DashboardFlags {
  const openTickets = loadTickets().filter(t => t.status === 'open')
  const allTickets = loadTickets()
  const orders = loadOrders()

  const slaFlags: SlaFlag[] = openTickets
    .map(buildSlaFlag)
    .filter((f): f is SlaFlag => f !== null)
    .sort(byWorstOverrun)

  // Security/high-severity auto-flag (design spec §9): credential-exposure/security-incident
  // language surfaced regardless of assigned severity, distinct from the general SLA list.
  const securityFlags: SlaFlag[] = openTickets
    .filter(isSecurityIncident)
    .map(buildSlaFlag)
    .filter((f): f is SlaFlag => f !== null)
    .sort(byWorstOverrun)

  const clusterMap = new Map<string, { ticketIds: string[]; accountIds: Set<string> }>()
  for (const t of openTickets) {
    const knownIssueId = matchKnownIssue(`${t.subject} ${t.description}`)
    if (!knownIssueId) continue
    const entry = clusterMap.get(knownIssueId) ?? { ticketIds: [], accountIds: new Set<string>() }
    entry.ticketIds.push(t.ticketId)
    entry.accountIds.add(t.accountId)
    clusterMap.set(knownIssueId, entry)
  }
  const knownIssueClusters: KnownIssueCluster[] = [...clusterMap.entries()].map(([knownIssueId, v]) => ({ knownIssueId, ticketIds: v.ticketIds, accountIds: [...v.accountIds] }))
  const crossAccountImpacts = knownIssueClusters.filter(c => c.accountIds.length > 1)

  const historicalAudits: HistoricalAudit[] = allTickets
    .filter(t => t.historicalResolution !== null)
    .map((t): HistoricalAudit => {
      // Cancellation-fee dispute: reconstruct the account's BOOKED order, re-run the calculator,
      // and compare its verdict against what the historical resolution claimed — in both
      // directions (waived-but-charged, and charged-with-a-mismatched-amount).
      if (isCancellationFeeDispute(t)) {
        // representative BOOKED order for this account (a cancellation-fee dispute is inherently
        // about a BOOKED, not-yet-picked-up shipment)
        const order = orders.find(o => o.accountId === t.accountId && o.status === 'BOOKED')
        if (!order) {
          // No BOOKED order to audit against — insufficient data, not a bug.
          return { ticketId: t.ticketId, reviewRecommended: false, discrepancy: null }
        }
        const current = calculateCancellationEligibility(order)
        const claimedMatch = t.historicalResolution?.match(CANCELLATION_FEE_AMOUNT_PATTERN) ?? null
        const claimedFee = claimedMatch ? Number(claimedMatch[1].replace(/,/g, '')) : null

        let discrepancy: string | null = null
        if (current.feeWaived && claimedFee !== null && claimedFee > 0) {
          discrepancy = `historical resolution charged a fee (INR ${claimedFee}); current calculation waives it entirely`
        } else if (!current.feeWaived && claimedFee !== null && claimedFee !== current.feeInr) {
          discrepancy = `historical resolution cited a fee of INR ${claimedFee}; current calculation is INR ${current.feeInr}`
        }
        return { ticketId: t.ticketId, reviewRecommended: discrepancy !== null, discrepancy }
      }
      // Bulk-upload row-limit dispute: compare the claimed limit in the historical resolution
      // against the actual documented product limit.
      if (isBulkUploadLimitDispute(t)) {
        const claimedMatch = t.historicalResolution?.match(BULK_UPLOAD_ROW_LIMIT_PATTERN) ?? null
        const claimedLimit = claimedMatch ? Number(claimedMatch[1].replace(/,/g, '')) : null
        const disagrees = claimedLimit !== null && claimedLimit !== PRODUCT_BULK_UPLOAD_ROW_LIMIT
        return {
          ticketId: t.ticketId,
          reviewRecommended: disagrees,
          discrepancy: disagrees
            ? `historical resolution cited a ${claimedLimit}-row limit; actual product limit is ${PRODUCT_BULK_UPLOAD_ROW_LIMIT} rows`
            : null,
        }
      }
      return { ticketId: t.ticketId, reviewRecommended: false, discrepancy: null }
    })

  const accountRollups = computeAccountRollups(slaFlags, knownIssueClusters, historicalAudits)

  return { slaFlags, securityFlags, knownIssueClusters, crossAccountImpacts, historicalAudits, accountRollups }
}
