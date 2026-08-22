import { describe, it, expect } from 'vitest'
import { createReadOnlyTools } from '../tools'

describe('createReadOnlyTools', () => {
  it('exposes exactly the document-search and structured-lookup/calculation tools', () => {
    const tools = createReadOnlyTools({ surface: 'customer', accountId: 'ACCT-001' })
    expect(Object.keys(tools).sort()).toEqual([
      'calculateCancellationEligibility', 'calculateServiceCredit', 'calculateSlaStatus',
      'getAccount', 'getOrder', 'getTicket', 'listOpenTickets', 'listOrdersForAccount', 'searchDocuments',
    ])
  })

  it('the getOrder tool enforces the caller\'s session — cannot fetch another account\'s order', async () => {
    const tools = createReadOnlyTools({ surface: 'customer', accountId: 'ACCT-002' })
    // @ts-expect-error — execute exists on every configured tool at runtime
    const result = await tools.getOrder.execute({ orderId: 'ORD-1001' })
    expect(result.found).toBe(false)
  })
})
