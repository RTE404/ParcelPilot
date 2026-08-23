import { ALL_CHUNKS } from '@/lib/data/documentChunks'
import type { DocumentChunk } from '@/lib/data/types'
import type { SessionIdentity } from '@/lib/identity/types'

export interface RankedChunk extends DocumentChunk {
  relevanceScore: number
  rankReason: string
}

function keywordScore(query: string, chunk: DocumentChunk): number {
  const terms = query.toLowerCase().split(/\W+/).filter(Boolean)
  const haystack = `${chunk.sectionTitle} ${chunk.text}`.toLowerCase()
  return terms.reduce((score, term) => (haystack.includes(term) ? score + 1 : score), 0)
}

export function searchDocuments(
  query: string,
  session: SessionIdentity,
  targetAccountId?: string,
): RankedChunk[] {
  const lowerQuery = query.toLowerCase()
  const wantsDeprecated = /deprecated|old policy|v2|previous version/.test(lowerQuery)

  // Access filter — applied before ranking, never after.
  const inScope = ALL_CHUNKS.filter(chunk => {
    if (chunk.accountScope === null) return true
    if (session.surface === 'customer') return chunk.accountScope === session.accountId
    // internal: allow retrieving a specific account's contract when investigating it,
    // otherwise still allow it (staff work a shared queue) — no restriction here,
    // role-based execution limits live in the action tool (Task 11), not retrieval.
    return true
  })

  const scored = inScope
    .map(chunk => ({ chunk, keyword: keywordScore(query, chunk) }))
    .filter(({ keyword }) => keyword > 0)
    .map(({ chunk, keyword }) => {
      let score = keyword
      let rankReason = `matched ${keyword} query term(s)`

      if (chunk.status === 'deprecated') {
        if (wantsDeprecated) {
          score += 10
          rankReason += '; explicitly requested deprecated version'
        } else {
          score -= 10
          rankReason += '; deprioritized — deprecated'
        }
      }

      const callerAccount = session.surface === 'customer' ? session.accountId : targetAccountId
      if (chunk.accountScope !== null && chunk.accountScope === callerAccount) {
        score += 5
        rankReason += '; boosted — caller\'s own contract'
      }

      return { ...chunk, relevanceScore: score, rankReason } as RankedChunk
    })
    .sort((a, b) => b.relevanceScore - a.relevanceScore)

  return scored
}
