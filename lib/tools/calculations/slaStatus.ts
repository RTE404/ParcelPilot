import type { Ticket, Account, Severity } from '@/lib/data/types'
import { getContractRule } from '@/lib/data/contractRules'

export interface SlaStatusResult {
  severity: Severity
  targetLabel: string
  elapsedMinutes: number
  targetMinutes: number
  breached: boolean
  citation: string
}

// Split so a P1 classification's origin (security-specific vs. general-outage) can be told apart
// — see isSecurityIncident below. P1_KEYWORDS remains the same combined list, so classifySeverity's
// behavior is unchanged.
const SECURITY_P1_KEYWORDS = ['api key', 'credential', 'security incident']
const GENERAL_OUTAGE_P1_KEYWORDS = ['all shipment creation is failing', 'complete outage', 'unable to create any shipment']
const P1_KEYWORDS = [...SECURITY_P1_KEYWORDS, ...GENERAL_OUTAGE_P1_KEYWORDS]
const P2_KEYWORDS = ['degraded', 'major feature unavailable', 'partially failing']

export function classifySeverity(ticket: Ticket): Severity {
  const text = `${ticket.subject} ${ticket.description}`.toLowerCase()
  if (P1_KEYWORDS.some(k => text.includes(k))) return 'P1'
  if (P2_KEYWORDS.some(k => text.includes(k))) return 'P2'
  return 'P3'
}

/**
 * True when the ticket's P1-triggering language is specifically security/credential-exposure
 * related (not general-outage language) — used by the dashboard's security auto-flag panel
 * (design spec §9) to surface these regardless of assigned severity.
 */
export function isSecurityIncident(ticket: Ticket): boolean {
  const text = `${ticket.subject} ${ticket.description}`.toLowerCase()
  return SECURITY_P1_KEYWORDS.some(k => text.includes(k))
}

// Default targets in minutes, per Support Policy v3 Section 3. Business-hour/business-day
// units are approximated as calendar time for this dataset's single-day snapshot window —
// documented simplification, see docs/HLD.md Non-Functional Design Goals.
const DEFAULT_TARGETS_MIN: Record<Account['plan'], Record<Severity, number>> = {
  Enterprise: { P1: 30, P2: 120, P3: 1440 },
  Growth:     { P1: 120, P2: 240, P3: 2880 },
  Standard:   { P1: 240, P2: 1440, P3: 2880 },
}

const OVERRIDE_LABEL_TO_MINUTES: Record<string, number> = {
  '15m': 15, '1h': 60, '8bh': 480, '2bh': 120, '4bh': 240, '2bd': 2880,
}

export function calculateSlaStatus(ticket: Ticket, account: Account, referenceNow: string): SlaStatusResult {
  const severity = classifySeverity(ticket)
  const rule = getContractRule(account.accountId)
  const overrideLabel = rule?.slaOverrides?.[severity]
  // An unrecognized override label must fail closed (behave like "no override"), not silently
  // produce `undefined`/NaN via a missing map entry — see M9. Only a label that actually
  // resolves counts as "the contract override was used" for both the target and the citation.
  const resolvedOverrideMinutes = overrideLabel ? OVERRIDE_LABEL_TO_MINUTES[overrideLabel] : undefined
  const targetMinutes = resolvedOverrideMinutes ?? DEFAULT_TARGETS_MIN[account.plan][severity]
  const elapsedMinutes = Math.round((new Date(referenceNow).getTime() - new Date(ticket.createdAt).getTime()) / 60000)

  return {
    severity,
    targetLabel: resolvedOverrideMinutes != null ? overrideLabel! : `${targetMinutes}m (policy default)`,
    elapsedMinutes,
    targetMinutes,
    breached: elapsedMinutes > targetMinutes,
    citation: resolvedOverrideMinutes != null ? rule!.sourceDoc : '01_Support_Policy_v3_CURRENT.pdf, Section 3',
  }
}
