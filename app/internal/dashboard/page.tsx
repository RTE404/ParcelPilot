import { redirect } from 'next/navigation'
import { requireSession } from '@/lib/identity/requireSession'
import { computeDashboardFlags } from '@/lib/dashboard/computeFlags'

export default async function Dashboard() {
  const session = await requireSession('internal')
  if (session.role !== 'manager') redirect('/internal/chat')

  const { slaFlags, knownIssueClusters, crossAccountImpacts, historicalAudits } = computeDashboardFlags()

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <h1 className="text-xl font-semibold">Issue Detection Dashboard</h1>

      <section>
        <h2 className="mb-2 font-medium">SLA status — open tickets</h2>
        <ul className="space-y-1 text-sm">
          {slaFlags.map(f => (
            <li key={f.ticketId} className={f.breached ? 'text-red-600' : ''}>
              {f.ticketId} — {f.severity} — {f.breached ? `BREACHED (${f.elapsedMinutes}m elapsed vs ${f.targetMinutes}m target)` : `${f.elapsedMinutes}m / ${f.targetMinutes}m`}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-medium">Known-issue clusters</h2>
        <ul className="space-y-1 text-sm">
          {knownIssueClusters.map(c => (
            <li key={c.knownIssueId}>
              {c.knownIssueId}: {c.ticketIds.join(', ')} {c.accountIds.length > 1 && <span className="ml-2 font-medium text-amber-600">— affects {c.accountIds.length} accounts</span>}
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
            <li key={a.ticketId} className="text-amber-700">{a.ticketId}: {a.discrepancy}</li>
          ))}
          {historicalAudits.every(a => !a.reviewRecommended) && <li className="text-gray-400">No discrepancies found.</li>}
        </ul>
      </section>
    </main>
  )
}
