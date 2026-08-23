import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import type { SessionIdentity } from '@/lib/identity/types'
import { getOrder, getTicket } from '@/lib/tools/structuredLookup'
import { recordAction } from './store/actionLog'
import { traceSpan } from '@/lib/observability/traceSpan'
import { REFERENCE_NOW } from '@/lib/data/loadData'

const APPROVAL_THRESHOLD_INR = 1000

export function createActionTools(session: SessionIdentity): ToolSet {
  const createEscalation = tool({
    description: 'Create a support escalation for a ticket. Requires explicit user confirmation before executing.',
    inputSchema: z.object({
      ticketId: z.string(),
      severity: z.enum(['P1', 'P2', 'P3']),
      reasonCode: z.enum(['SOURCE_CONFLICT', 'MISSING_DATA', 'OUTSIDE_SCOPE', 'EXCEEDS_APPROVAL_LIMIT', 'SLA_BREACH', 'SECURITY_INCIDENT', 'UNSUPPORTED_REQUEST']),
      note: z.string(),
    }),
    needsApproval: true,
    execute: ({ ticketId, severity, reasonCode, note }) =>
      traceSpan('action.createEscalation', { ticketId }, async () => {
        const ticketResult = getTicket(ticketId, session)
        const accountId = ticketResult.found ? ticketResult.record.accountId : 'unknown'
        recordAction({ accountId, type: 'escalation', createdAt: REFERENCE_NOW })
        return { authorized: true, escalationId: `ESC-${ticketId}-${Date.now()}`, ticketId, severity, reasonCode, note }
      }),
  })

  if (session.surface === 'customer') {
    return { createEscalation }
  }

  const updateTicketSeverity = tool({
    description: 'Update a ticket\'s severity classification. Requires explicit user confirmation before executing.',
    inputSchema: z.object({ ticketId: z.string(), newSeverity: z.enum(['P1', 'P2', 'P3']) }),
    needsApproval: true,
    execute: ({ ticketId, newSeverity }) =>
      traceSpan('action.updateTicketSeverity', { ticketId }, async () => ({ authorized: true, ticketId, newSeverity })),
  })

  const approveCredit = tool({
    description: 'Approve a service credit for an order. Amounts over ₹1,000 require a manager-role session — the check is re-verified here, at execution time, not just when proposed.',
    inputSchema: z.object({ orderId: z.string(), amountInr: z.number(), ticketId: z.string() }),
    needsApproval: true,
    execute: ({ orderId, amountInr, ticketId }) =>
      traceSpan('action.approveCredit', { orderId, amountInr }, async () => {
        if (amountInr > APPROVAL_THRESHOLD_INR && session.role !== 'manager') {
          return { authorized: false, reason: `credits over ₹${APPROVAL_THRESHOLD_INR} require a manager-role session; this session is ${session.role}` }
        }
        const orderResult = getOrder(orderId, session)
        const accountId = orderResult.found ? orderResult.record.accountId : 'unknown'
        recordAction({ accountId, type: 'credit', amountInr, createdAt: REFERENCE_NOW })
        return { authorized: true, orderId, amountInr, ticketId }
      }),
  })

  const createFollowupTask = tool({
    description: 'Create a follow-up task for staff. Requires explicit user confirmation before executing.',
    inputSchema: z.object({ description: z.string(), relatedTicketId: z.string().optional() }),
    needsApproval: true,
    execute: ({ description, relatedTicketId }) =>
      traceSpan('action.createFollowupTask', { relatedTicketId }, async () => ({ authorized: true, taskId: `TASK-${Date.now()}`, description })),
  })

  return { createEscalation, updateTicketSeverity, approveCredit, createFollowupTask }
}
