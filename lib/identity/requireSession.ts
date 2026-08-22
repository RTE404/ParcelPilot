import { redirect } from 'next/navigation'
import { getSessionIdentity } from './session'
import type { SessionIdentity, Surface } from './types'

export function isAllowed(session: SessionIdentity | null, surface: Surface): boolean {
  return session !== null && session.surface === surface
}

export async function requireSession(surface: Surface): Promise<SessionIdentity> {
  const session = await getSessionIdentity()
  if (!isAllowed(session, surface)) {
    redirect(surface === 'customer' ? '/customer/login' : '/internal/login')
  }
  return session as SessionIdentity
}
