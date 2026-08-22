import { describe, it, expect } from 'vitest'
import { searchDocuments } from '../documentSearch'

describe('searchDocuments', () => {
  it('excludes another customer\'s contract from a customer session', () => {
    const session = { surface: 'customer' as const, accountId: 'ACCT-002' }
    const results = searchDocuments('cancellation fee', session)
    expect(results.some(r => r.accountScope === 'ACCT-001')).toBe(false)
  })

  it('ranks the caller\'s own contract clause above the general SOP for the same topic', () => {
    const session = { surface: 'customer' as const, accountId: 'ACCT-001' }
    const results = searchDocuments('cancellation fee', session)
    const contractIdx = results.findIndex(r => r.accountScope === 'ACCT-001')
    const sopIdx = results.findIndex(r => r.docType === 'sop')
    expect(contractIdx).toBeGreaterThanOrEqual(0)
    expect(sopIdx).toBeGreaterThanOrEqual(0)
    expect(contractIdx).toBeLessThan(sopIdx)
  })

  it('deprioritizes deprecated policy chunks below current ones for the same topic', () => {
    const session = { surface: 'internal' as const, staffId: 'rohit', role: 'support_agent' as const }
    const results = searchDocuments('P1 response time', session)
    const currentIdx = results.findIndex(r => r.status === 'current')
    const deprecatedIdx = results.findIndex(r => r.status === 'deprecated')
    expect(currentIdx).toBeGreaterThanOrEqual(0)
    expect(deprecatedIdx).toBeGreaterThan(currentIdx)
  })

  it('surfaces the deprecated doc first only when explicitly asked for it', () => {
    const session = { surface: 'internal' as const, staffId: 'rohit', role: 'support_agent' as const }
    const results = searchDocuments('what did the deprecated v2 policy say about P1', session)
    expect(results[0].status).toBe('deprecated')
  })

  it('lets an internal session retrieve any account\'s contract when investigating it', () => {
    const session = { surface: 'internal' as const, staffId: 'priya_mehta', role: 'manager' as const }
    const results = searchDocuments('LumenWorks failed pickup credit', session, 'ACCT-002')
    expect(results.some(r => r.accountScope === 'ACCT-002')).toBe(true)
  })
})
