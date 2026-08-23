import type { ReactNode } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireSession } from '@/lib/identity/requireSession'
import { computeDashboardFlags } from '@/lib/dashboard/computeFlags'

// I8: each flag traces back to a single ticket in this dataset (see lib/data/types.ts — Ticket
// has no distinct order-scoped flag surface here), so every click-through uses `?ticketId=`.
function TicketLink({ ticketId, children }: { ticketId: string; children: ReactNode }) {
  return (
    <Link href={`/internal/chat?ticketId=${ticketId}`} className="text-blue-700 hover:underline">
      {children}
    </Link>
  )
}

export default async function Dashboard() {
  const session = await requireSession('internal')
  if (session.role !== 'manager') redirect('/internal/chat')

  const { slaFlags, securityFlags, knownIssueClusters, crossAccountImpacts, historicalAudits, accountRollups } = computeDashboardFlags()

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <h1 className="text-xl font-semibold">Issue Detection Dashboard</h1>

      <section>
        <h2 className="mb-2 font-medium">Accounts needing attention</h2>
        <ul className="space-y-1 text-sm">
          {accountRollups.map(r => (
            <li key={r.accountId}>
              <span className="font-medium">{r.accountName}</span> — {r.breachCount} SLA breach{r.breachCount === 1 ? '' : 'es'}, {r.knownIssueCount} known-issue match{r.knownIssueCount === 1 ? '' : 'es'}, {r.historicalFlagCount} historical flag{r.historicalFlagCount === 1 ? '' : 's'}
            </li>
          ))}
          {accountRollups.length === 0 && <li className="text-gray-400">No accounts currently need attention.</li>}
        </ul>
      </section>

      <section className="rounded-lg border-2 border-red-500 bg-red-50 p-4">
        <h2 className="mb-2 font-medium text-red-800">Security / credential-exposure auto-flag</h2>
        <ul className="space-y-1 text-sm">
          {securityFlags.map(f => (
            <li key={f.ticketId} className="text-red-700">
              <TicketLink ticketId={f.ticketId}>{f.ticketId}</TicketLink> — {f.severity} — {f.breached ? `BREACHED (${f.elapsedMinutes}m elapsed vs ${f.targetMinutes}m target)` : `${f.elapsedMinutes}m / ${f.targetMinutes}m`}
            </li>
          ))}
          {securityFlags.length === 0 && <li className="text-gray-400">None currently.</li>}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-medium">SLA status — open tickets</h2>
        <ul className="space-y-1 text-sm">
          {slaFlags.map(f => (
            <li key={f.ticketId} className={f.breached ? 'text-red-600' : ''}>
              <TicketLink ticketId={f.ticketId}>{f.ticketId}</TicketLink> — {f.severity} — {f.breached ? `BREACHED (${f.elapsedMinutes}m elapsed vs ${f.targetMinutes}m target)` : `${f.elapsedMinutes}m / ${f.targetMinutes}m`}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-medium">Known-issue clusters</h2>
        <ul className="space-y-1 text-sm">
          {knownIssueClusters.map(c => (
            <li key={c.knownIssueId}>
              {c.knownIssueId}: {c.ticketIds.map((id, i) => (
                <span key={id}>
                  {i > 0 && ', '}
                  <TicketLink ticketId={id}>{id}</TicketLink>
                </span>
              ))} {c.accountIds.length > 1 && <span className="ml-2 font-medium text-amber-600">— affects {c.accountIds.length} accounts</span>}
            </li>
          ))}
          {knownIssueClusters.length === 0 && <li className="text-gray-400">None currently.</li>}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-medium">Cross-account impact</h2>
        <ul className="space-y-1 text-sm">
          {crossAccountImpacts.map(c => (<li key={c.knownIssueId}>{c.knownIssueId} — {c.accountIds.join(', ')}</li>))}
          {crossAccountImpacts.length === 0 && <li className="text-gray-400">None currently.</li>}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-medium">Historical-resolution audit</h2>
        <ul className="space-y-1 text-sm">
          {historicalAudits.filter(a => a.reviewRecommended).map(a => (
            <li key={a.ticketId} className="text-amber-700">
              <TicketLink ticketId={a.ticketId}>{a.ticketId}</TicketLink>: {a.discrepancy}
            </li>
          ))}
          {historicalAudits.every(a => !a.reviewRecommended) && <li className="text-gray-400">No discrepancies found.</li>}
        </ul>
      </section>
    </main>
  )
}
