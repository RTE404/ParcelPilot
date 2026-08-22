import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { LOGIN_OPTIONS, encodeSession, SESSION_COOKIE_NAME } from '@/lib/identity/session'

export async function POST(req: Request) {
  const { key, redirectTo } = await req.json()
  const identity = LOGIN_OPTIONS[key]
  if (!identity) return NextResponse.json({ error: 'unknown login option' }, { status: 400 })

  const store = await cookies()
  store.set(SESSION_COOKIE_NAME, encodeSession(identity), { httpOnly: true, sameSite: 'lax', path: '/' })
  return NextResponse.json({ redirectTo })
}
