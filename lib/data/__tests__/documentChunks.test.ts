import { describe, it, expect } from 'vitest'
import { ALL_CHUNKS } from '../documentChunks'

describe('documentChunks', () => {
  it('tags Policy v3 as current and Policy v2 as deprecated', () => {
    const v3 = ALL_CHUNKS.filter(c => c.docId === '01_support_policy_v3')
    const v2 = ALL_CHUNKS.filter(c => c.docId === '02_support_policy_v2')
    expect(v3.length).toBeGreaterThan(0)
    expect(v2.length).toBeGreaterThan(0)
    expect(v3.every(c => c.status === 'current')).toBe(true)
    expect(v2.every(c => c.status === 'deprecated')).toBe(true)
  })

  it('scopes contract chunks to their single account', () => {
    const northstarChunks = ALL_CHUNKS.filter(c => c.docId === '05_northstar_agreement')
    const lumenworksChunks = ALL_CHUNKS.filter(c => c.docId === '06_lumenworks_agreement')
    expect(northstarChunks.every(c => c.accountScope === 'ACCT-001')).toBe(true)
    expect(lumenworksChunks.every(c => c.accountScope === 'ACCT-002')).toBe(true)
  })

  it('has no accountScope on general policy/SOP/guide chunks', () => {
    const general = ALL_CHUNKS.filter(c => c.docType !== 'contract')
    expect(general.every(c => c.accountScope === null)).toBe(true)
  })

  it('contains the Northstar cancellation-fee-waiver clause text', () => {
    const clause = ALL_CHUNKS.find(c => c.docId === '05_northstar_agreement' && c.sectionTitle.includes('cancellation'))
    expect(clause?.text).toContain('no cancellation fee')
  })
})
