import { loadTickets, loadOrders, getAccountById, REFERENCE_NOW } from '@/lib/data/loadData'
import { calculateSlaStatus } from '@/lib/tools/calculations/slaStatus'
import { calculateCancellationEligibility } from '@/lib/tools/calculations/cancellationEligibility'
import { matchKnownIssue } from './knownIssues'

export interface SlaFlag { ticketId: string; severity: string; breached: boolean; elapsedMinutes: number; targetMinutes: number }
export interface KnownIssueCluster { knownIssueId: string; ticketIds: string[]; accountIds: string[] }
export interface HistoricalAudit { ticketId: string; reviewRecommended: boolean; discrepancy: string | null }

export interface DashboardFlags {
  slaFlags: SlaFlag[]
  knownIssueClusters: KnownIssueCluster[]
  crossAccountImpacts: KnownIssueCluster[]
  historicalAudits: HistoricalAudit[]
}

export function computeDashboardFlags(): DashboardFlags {
  const openTickets = loadTickets().filter(t => t.status === 'open')
  const allTickets = loadTickets()
  const orders = loadOrders()

  const slaFlags: SlaFlag[] = openTickets
    .map((t): SlaFlag | null => {
      const account = getAccountById(t.accountId)
      if (!account) return null
      const status = calculateSlaStatus(t, account, REFERENCE_NOW)
      return { ticketId: t.ticketId, severity: status.severity, breached: status.breached, elapsedMinutes: status.elapsedMinutes, targetMinutes: status.targetMinutes }
    })
    .filter((f): f is SlaFlag => f !== null)
    .sort((a, b) => (b.elapsedMinutes - b.targetMinutes) - (a.elapsedMinutes - a.targetMinutes))

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
    .map(t => {
      // TKT-450: historical resolution claimed a ₹250 fee applied; Northstar's contract waives fees entirely.
      if (t.ticketId === 'TKT-450') {
        const order = orders.find(o => o.accountId === t.accountId) // representative order for this account
        const current = order ? calculateCancellationEligibility(order) : null
        const disagrees = current?.feeWaived === true && /250/.test(t.historicalResolution ?? '')
        return { ticketId: t.ticketId, reviewRecommended: disagrees, discrepancy: disagrees ? 'historical resolution charged a fee; current contract waives it entirely' : null }
      }
      // TKT-451: historical resolution conflated the KI-208 failure threshold (~3,000 rows) with the actual 5,000-row product limit.
      if (t.ticketId === 'TKT-451') {
        const disagrees = /3,?000/.test(t.historicalResolution ?? '')
        return { ticketId: t.ticketId, reviewRecommended: disagrees, discrepancy: disagrees ? 'historical resolution cited the known-issue threshold (3,000 rows) as the product limit; actual limit is 5,000 rows' : null }
      }
      return { ticketId: t.ticketId, reviewRecommended: false, discrepancy: null }
    })

  return { slaFlags, knownIssueClusters, crossAccountImpacts, historicalAudits }
}
