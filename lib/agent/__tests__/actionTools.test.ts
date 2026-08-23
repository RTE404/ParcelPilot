import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createActionTools } from '../actionTools'
import * as actionLogStore from '../store/actionLog'
import { resetActionLog } from '../store/actionLog'

const managerSession = { surface: 'internal' as const, staffId: 'priya_mehta', role: 'manager' as const }
const agentSession = { surface: 'internal' as const, staffId: 'rohit', role: 'support_agent' as const }
const customerSession = { surface: 'customer' as const, accountId: 'ACCT-001' }

describe('createActionTools', () => {
  beforeEach(() => resetActionLog())
  afterEach(() => vi.restoreAllMocks())

  it('marks every action tool as needing approval', () => {
    const tools = createActionTools(managerSession)
    expect(tools.createEscalation.needsApproval).toBe(true)
    expect(tools.approveCredit.needsApproval).toBe(true)
    expect(tools.updateTicketSeverity.needsApproval).toBe(true)
    expect(tools.createFollowupTask.needsApproval).toBe(true)
  })

  it('blocks a support_agent session from executing a credit approval over ₹1,000', async () => {
    const tools = createActionTools(agentSession)
    // @ts-expect-error execute exists at runtime
    const result = await tools.approveCredit.execute({ orderId: 'ORD-2002', amountInr: 1500, ticketId: 'TKT-501' })
    expect(result.authorized).toBe(false)
  })

  it('allows a manager session to execute a credit approval over ₹1,000', async () => {
    const tools = createActionTools(managerSession)
    // @ts-expect-error execute exists at runtime
    const result = await tools.approveCredit.execute({ orderId: 'ORD-2002', amountInr: 1500, ticketId: 'TKT-501' })
    expect(result.authorized).toBe(true)
  })

  it('allows a support_agent session to execute a credit approval at or under ₹1,000', async () => {
    const tools = createActionTools(agentSession)
    // @ts-expect-error execute exists at runtime
    const result = await tools.approveCredit.execute({ orderId: 'ORD-2002', amountInr: 1000, ticketId: 'TKT-501' })
    expect(result.authorized).toBe(true)
  })

  it('exposes only createEscalation to a customer session\'s tool set', () => {
    const tools = createActionTools(customerSession)
    expect(Object.keys(tools)).toEqual(['createEscalation'])
  })

  // I6 step 3: createEscalation must derive the real accountId from the ticket, the same way
  // approveCredit already derives it from the order, instead of always recording 'unknown'.
  it('derives accountId from the ticket when creating an escalation for an existing ticket', async () => {
    const recordSpy = vi.spyOn(actionLogStore, 'recordAction')
    const tools = createActionTools(customerSession)
    // @ts-expect-error execute exists at runtime
    await tools.createEscalation.execute({ ticketId: 'TKT-501', severity: 'P1', reasonCode: 'SLA_BREACH', note: 'test' })

    expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'ACCT-001', type: 'escalation' }))
  })

  it('falls back to accountId \'unknown\' when the escalation\'s ticket is not found or not accessible', async () => {
    const recordSpy = vi.spyOn(actionLogStore, 'recordAction')
    const tools = createActionTools(customerSession)
    // @ts-expect-error execute exists at runtime
    await tools.createEscalation.execute({ ticketId: 'TKT-DOES-NOT-EXIST', severity: 'P1', reasonCode: 'SLA_BREACH', note: 'test' })

    expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'unknown', type: 'escalation' }))
  })
})
