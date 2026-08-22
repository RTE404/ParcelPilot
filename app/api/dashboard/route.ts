import { NextResponse } from 'next/server'
import { getSessionIdentity } from '@/lib/identity/session'
import { computeDashboardFlags } from '@/lib/dashboard/computeFlags'

export async function GET() {
  const session = await getSessionIdentity()
  if (!session || session.surface !== 'internal' || session.role !== 'manager') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  return NextResponse.json(computeDashboardFlags())
}
