export interface KnownIssueDefinition { id: string; keywords: (string | RegExp)[] }

// Matches a digit followed (optionally through a hyphen) by "row"/"rows", e.g. "4,200-row" or
// "3500 rows" — but not the bare substring "row", which also matches "throw", "grow", "browser".
const ROW_COUNT_PATTERN = /\d[\d,]*\s*-?\s*rows?\b/

export const KNOWN_ISSUES: KnownIssueDefinition[] = [
  { id: 'KI-208', keywords: ['csv', 'bulk upload', ROW_COUNT_PATTERN] },
  // 'pickup' intentionally excluded: on its own it matches any pickup mention, correct or not,
  // and would silently cluster genuinely new pickup incidents under this known issue.
  { id: 'KI-211', keywords: ['swiftship', 'still shows booked', 'webhook'] },
]

export function matchKnownIssue(text: string): string | null {
  const lower = text.toLowerCase()
  const match = KNOWN_ISSUES.find(ki =>
    ki.keywords.some(k => (typeof k === 'string' ? lower.includes(k) : k.test(lower)))
  )
  return match?.id ?? null
}
