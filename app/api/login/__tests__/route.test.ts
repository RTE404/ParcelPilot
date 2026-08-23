import { describe, it, expect, vi, beforeEach } from 'vitest'

const setMock = vi.fn()
vi.mock('next/headers', () => ({ cookies: vi.fn(() => ({ set: setMock })) }))

import { POST } from '../route'

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/login', { method: 'POST', body: JSON.stringify(body) })
}

describe('POST /api/login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets a session cookie and echoes redirectTo for a known login option', async () => {
    const res = await POST(jsonRequest({ key: 'northstar', redirectTo: '/customer' }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ redirectTo: '/customer' })
    expect(setMock).toHaveBeenCalledTimes(1)
    const [cookieName, , options] = setMock.mock.calls[0]
    expect(cookieName).toBe('pp_session')
    expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 })
    expect(options).toHaveProperty('secure')
  })

  it('returns 400 for an unknown login option and never sets a cookie', async () => {
    const res = await POST(jsonRequest({ key: 'not-a-real-option' }))

    expect(res.status).toBe(400)
    expect(setMock).not.toHaveBeenCalled()
  })

  // M10: a malformed body must return a clean 400, never an unhandled rejection/500, and must
  // never reach the cookie-setting step.
  it('returns 400 (not 500/an unhandled rejection) when the request body is not valid JSON', async () => {
    const res = await POST(new Request('http://localhost/api/login', { method: 'POST', body: '{not json' }))

    expect(res.status).toBe(400)
    expect(setMock).not.toHaveBeenCalled()
  })
})
