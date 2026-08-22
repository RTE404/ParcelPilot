import { describe, it, expect } from 'vitest'
import { LOGIN_OPTIONS, encodeSession, decodeSession } from '../session'

describe('session identity', () => {
  it('maps rohit to support_agent and priya to manager', () => {
    expect(LOGIN_OPTIONS.rohit).toEqual({ surface: 'internal', staffId: 'rohit', role: 'support_agent' })
    expect(LOGIN_OPTIONS.priya).toEqual({ surface: 'internal', staffId: 'priya_mehta', role: 'manager' })
  })

  it('maps northstar to a customer session pinned to ACCT-001', () => {
    expect(LOGIN_OPTIONS.northstar).toEqual({ surface: 'customer', accountId: 'ACCT-001' })
  })

  it('round-trips a session through encode/decode', () => {
    const original = LOGIN_OPTIONS.lumenworks
    const encoded = encodeSession(original)
    expect(decodeSession(encoded)).toEqual(original)
  })

  it('returns null decoding garbage input rather than throwing', () => {
    expect(decodeSession('not-valid-json')).toBeNull()
  })
})
