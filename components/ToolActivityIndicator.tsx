const RUNNING_LABELS: Record<string, string> = {
  searchDocuments: 'Searching documents...',
  getOrder: 'Looking up order...',
  getAccount: 'Looking up account...',
  getTicket: 'Looking up ticket...',
  listOpenTickets: 'Listing open tickets...',
  calculateCancellationEligibility: 'Calculating cancellation eligibility...',
  calculateServiceCredit: 'Calculating service credit...',
  calculateSlaStatus: 'Calculating SLA status...',
  createEscalation: 'Preparing escalation...',
  updateTicketSeverity: 'Preparing ticket update...',
  approveCredit: 'Preparing credit approval...',
  createFollowupTask: 'Preparing follow-up task...',
}

const DONE_LABELS: Record<string, string> = {
  searchDocuments: 'Searched documents',
  getOrder: 'Looked up order',
  getAccount: 'Looked up account',
  getTicket: 'Looked up ticket',
  listOpenTickets: 'Listed open tickets',
  calculateCancellationEligibility: 'Calculated cancellation eligibility',
  calculateServiceCredit: 'Calculated service credit',
  calculateSlaStatus: 'Calculated SLA status',
  createEscalation: 'Prepared escalation',
  updateTicketSeverity: 'Prepared ticket update',
  approveCredit: 'Prepared credit approval',
  createFollowupTask: 'Prepared follow-up task',
}

export function ToolActivityIndicator({ toolName, state }: { toolName: string; state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error' }) {
  const isDone = state === 'output-available' || state === 'output-error'
  const label = isDone ? (DONE_LABELS[toolName] ?? `Ran ${toolName}`) : (RUNNING_LABELS[toolName] ?? `Running ${toolName}...`)
  return (
    <div className="my-1 flex items-center gap-2 text-xs text-gray-500">
      <span className={isDone ? 'text-green-600' : 'animate-pulse text-blue-600'}>{isDone ? '✓' : '●'}</span>
      <span>{label}</span>
    </div>
  )
}
