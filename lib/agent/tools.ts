import { tool } from 'ai'
import { z } from 'zod'
import { searchDocuments } from '@/lib/tools/documentSearch'
import { getOrder, getAccount, getTicket, listOpenTickets } from '@/lib/tools/structuredLookup'
import { calculateCancellationEligibility } from '@/lib/tools/calculations/cancellationEligibility'
import { calculateServiceCredit } from '@/lib/tools/calculations/serviceCredit'
import { calculateSlaStatus } from '@/lib/tools/calculations/slaStatus'
import { traceSpan } from '@/lib/observability/traceSpan'
import { REFERENCE_NOW } from '@/lib/data/loadData'
import type { SessionIdentity } from '@/lib/identity/types'
import { getMonthlyCreditsForAccount } from './store/actionLog'

export function createReadOnlyTools(session: SessionIdentity) {
  return {
    searchDocuments: tool({
      description: 'Search ParcelPilot policies, SOPs, product docs, and contracts. Results are ranked by authority (current > deprecated, own contract > general policy).',
      inputSchema: z.object({ query: z.string(), targetAccountId: z.string().optional() }),
      execute: ({ query, targetAccountId }) =>
        traceSpan('tool.searchDocuments', { query }, async () => searchDocuments(query, session, targetAccountId)),
    }),
    getOrder: tool({
      description: 'Fetch an order by ID, scoped to the caller\'s access.',
      inputSchema: z.object({ orderId: z.string() }),
      execute: ({ orderId }) => traceSpan('tool.getOrder', { orderId }, async () => getOrder(orderId, session)),
    }),
    getAccount: tool({
      description: 'Fetch account details, scoped to the caller\'s access.',
      inputSchema: z.object({ accountId: z.string().optional() }),
      execute: ({ accountId }) => traceSpan('tool.getAccount', { accountId }, async () => getAccount(session, accountId)),
    }),
    getTicket: tool({
      description: 'Fetch a support ticket by ID, scoped to the caller\'s access.',
      inputSchema: z.object({ ticketId: z.string() }),
      execute: ({ ticketId }) => traceSpan('tool.getTicket', { ticketId }, async () => getTicket(ticketId, session)),
    }),
    listOpenTickets: tool({
      description: 'List currently open tickets, scoped to the caller\'s access.',
      inputSchema: z.object({}),
      execute: () => traceSpan('tool.listOpenTickets', {}, async () => listOpenTickets(session)),
    }),
    calculateCancellationEligibility: tool({
      description: 'Determine whether an order can be cancelled and whether a fee applies, applying any contract override.',
      inputSchema: z.object({ orderId: z.string() }),
      execute: ({ orderId }) => traceSpan('tool.calcCancellation', { orderId }, async () => {
        const result = getOrder(orderId, session)
        if (!result.found) return { error: 'order not found or not accessible' }
        return calculateCancellationEligibility(result.record)
      }),
    }),
    calculateServiceCredit: tool({
      description: 'Determine service-credit eligibility and amount for a late pickup, applying any contract override.',
      inputSchema: z.object({ orderId: z.string() }),
      execute: ({ orderId }) => traceSpan('tool.calcCredit', { orderId }, async () => {
        const result = getOrder(orderId, session)
        if (!result.found) return { error: 'order not found or not accessible' }
        return calculateServiceCredit(result.record, REFERENCE_NOW, getMonthlyCreditsForAccount(result.record.accountId))
      }),
    }),
    calculateSlaStatus: tool({
      description: 'Classify a ticket\'s severity and determine whether its SLA target has been breached as of the reference time.',
      inputSchema: z.object({ ticketId: z.string() }),
      execute: ({ ticketId }) => traceSpan('tool.calcSla', { ticketId }, async () => {
        const ticketResult = getTicket(ticketId, session)
        if (!ticketResult.found) return { error: 'ticket not found or not accessible' }
        const accountResult = getAccount(session, ticketResult.record.accountId)
        if (!accountResult.found) return { error: 'account not found' }
        return calculateSlaStatus(ticketResult.record, accountResult.record, REFERENCE_NOW)
      }),
    }),
  }
}
