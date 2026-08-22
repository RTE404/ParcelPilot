import type { SessionIdentity } from './types'

export const SESSION_COOKIE_NAME = 'pp_session'

export const LOGIN_OPTIONS: Record<string, SessionIdentity> = {
  northstar:  { surface: 'customer', accountId: 'ACCT-001' },
  lumenworks: { surface: 'customer', accountId: 'ACCT-002' },
  beacon:     { surface: 'customer', accountId: 'ACCT-003' },
  axislabs:   { surface: 'customer', accountId: 'ACCT-004' },
  rohit:      { surface: 'internal', staffId: 'rohit', role: 'support_agent' },
  priya:      { surface: 'internal', staffId: 'priya_mehta', role: 'manager' },
}

export function encodeSession(identity: SessionIdentity): string {
  return Buffer.from(JSON.stringify(identity)).toString('base64url')
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isValidSessionShape(parsed: unknown): parsed is SessionIdentity {
  if (!parsed || typeof parsed !== 'object') return false
  const candidate = parsed as Record<string, unknown>

  if (candidate.surface === 'customer') {
    return isNonEmptyString(candidate.accountId)
  }

  if (candidate.surface === 'internal') {
    return (
      isNonEmptyString(candidate.staffId) &&
      (candidate.role === 'support_agent' || candidate.role === 'manager')
    )
  }

  return false
}

export function decodeSession(value: string | undefined | null): SessionIdentity | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (isValidSessionShape(parsed)) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

import { cookies } from 'next/headers'

export async function getSessionIdentity(): Promise<SessionIdentity | null> {
  const store = await cookies()
  return decodeSession(store.get(SESSION_COOKIE_NAME)?.value)
}
