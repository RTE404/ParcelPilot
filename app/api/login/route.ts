import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { LOGIN_OPTIONS, encodeSession, SESSION_COOKIE_NAME } from '@/lib/identity/session'

const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 // one day — mock-auth demo app, no re-auth flow

export async function POST(req: Request) {
  let key: string
  let redirectTo: unknown
  try {
    const body = await req.json()
    key = body.key
    redirectTo = body.redirectTo
  } catch {
    return NextResponse.json({ error: 'invalid request body' }, { status: 400 })
  }

  const identity = LOGIN_OPTIONS[key]
  if (!identity) return NextResponse.json({ error: 'unknown login option' }, { status: 400 })

  const store = await cookies()
  store.set(SESSION_COOKIE_NAME, encodeSession(identity), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  })
  return NextResponse.json({ redirectTo })
}
