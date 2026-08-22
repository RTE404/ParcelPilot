import { describe, it, expect, beforeEach } from 'vitest'
import { createActionTools } from '../actionTools'
import { resetActionLog } from '../store/actionLog'

const managerSession = { surface: 'internal' as const, staffId: 'priya_mehta', role: 'manager' as const }
const agentSession = { surface: 'internal' as const, staffId: 'rohit', role: 'support_agent' as const }
const customerSession = { surface: 'customer' as const, accountId: 'ACCT-001' }

describe('createActionTools', () => {
  beforeEach(() => resetActionLog())

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
})
