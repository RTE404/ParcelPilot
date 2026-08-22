export interface KnownIssueDefinition { id: string; keywords: string[] }

export const KNOWN_ISSUES: KnownIssueDefinition[] = [
  { id: 'KI-208', keywords: ['csv', 'bulk upload', 'row'] },
  { id: 'KI-211', keywords: ['swiftship', 'still shows booked', 'webhook', 'pickup'] },
]

export function matchKnownIssue(text: string): string | null {
  const lower = text.toLowerCase()
  const match = KNOWN_ISSUES.find(ki => ki.keywords.some(k => lower.includes(k)))
  return match?.id ?? null
}
