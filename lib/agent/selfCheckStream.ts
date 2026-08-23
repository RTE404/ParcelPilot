import type { UIMessage, UIMessageChunk } from 'ai'
import type { SelfCheckResult } from './selfCheck'

/** Tool names whose invocation this turn forces a self-check pass regardless of digit content. */
export const ACTION_TOOL_NAMES = new Set(['createEscalation', 'updateTicketSeverity', 'approveCredit', 'createFollowupTask'])

export const SELF_CHECK_ESCALATION_MESSAGE =
  "I wasn't able to verify this answer against the available data with enough confidence to present it, so I'm escalating this for a team member to review directly rather than risk giving you incorrect information."

/** Design spec §5.4 "Trust and Reliability" confidence labels, shown as a badge on every direct answer. */
export type ConfidenceLabel = 'High' | 'Resolved conflict' | 'Low' | 'Escalated'

/** Which of `runSelfCheckStream`'s outcome branches produced the answer being labeled this turn. */
export type SelfCheckOutcome = 'not-checked' | 'passed' | 'revised' | 'escalated'

// The SOP/policy docs every calculator falls back to when no contract override applies (see
// lib/tools/calculations/serviceCredit.ts, slaStatus.ts, cancellationEligibility.ts). A citation
// that does NOT start with one of these names an account-specific contract file instead.
const DEFAULT_DOC_CITATION_PREFIXES = ['03_Cancellation_and_Service_Credit_SOP_v4.pdf', '01_Support_Policy_v3_CURRENT.pdf']

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Deterministically derives a confidence label (design spec §5.4) from signals already available
 * at the point `runSelfCheckStream` decides what final text to emit — no LLM call, per this
 * codebase's "no LLM calls" constraint for deterministic dashboard-style computation (LLD §9).
 *
 * This is a heuristic APPROXIMATION of the spec's intent, not a literal conflict-detector — the
 * same kind of honest simplification as `lib/tools/calculations/slaStatus.ts`'s business-hour
 * comment. In particular, "Resolved conflict" is inferred from a tool result citing something
 * other than the known default SOP/policy docs, which is a proxy for "an account-specific rule
 * fired instead of the generic default," not proof that two sources actually disagreed — a
 * contract override that simply matches the default's numbers would still read as "resolved
 * conflict" here, and a genuine disagreement between two non-default sources wouldn't be
 * distinguished from a single account-specific override.
 */
export function classifyConfidence(outcome: SelfCheckOutcome, allToolResults: unknown[]): ConfidenceLabel {
  const anyEscalateFlag = allToolResults.some(result => isPlainObject(result) && Boolean(result.escalate))
  if (outcome === 'escalated' || anyEscalateFlag) return 'Escalated'

  const anyOverrideCitation = allToolResults.some(result => {
    if (!isPlainObject(result) || typeof result.citation !== 'string') return false
    return !DEFAULT_DOC_CITATION_PREFIXES.some(prefix => (result.citation as string).startsWith(prefix))
  })
  if (anyOverrideCitation) return 'Resolved conflict'

  if (outcome === 'revised') return 'Low'

  return 'High'
}

export interface UIMessageStreamWriterLike {
  write(chunk: UIMessageChunk): void
}

export interface RunSelfCheckStreamOptions {
  /** The raw chunk stream from `result.toUIMessageStream()` (NOT `result.fullStream`). */
  chunks: AsyncIterable<UIMessageChunk>
  /** The UI message stream writer to forward non-text chunks and the final text to. */
  writer: UIMessageStreamWriterLike
  /** Runs a self-check pass against a draft answer and this turn's tool results. */
  runSelfCheck: (draftAnswer: string, toolResultsThisTurn: unknown[]) => Promise<SelfCheckResult>
  /** Produces a revised answer given the failing draft, the issues found, and this turn's tool results. */
  reviseAnswer: (bufferedText: string, issues: string[], toolResultsThisTurn: unknown[]) => Promise<string>
  /**
   * Tool results from earlier turns in this conversation (extracted from message history via
   * `extractToolResultsFromMessages`), so the self-check pass isn't limited to only the current
   * HTTP request's chunk stream — which, after a tool-approval resend, typically contains only
   * the just-approved action tool's output. Defaults to `[]`.
   */
  priorToolResults?: unknown[]
}

/**
 * Extracts the `output` of every tool part in `output-available` state across a message history,
 * in message order. Used to give the self-check pass visibility into read-only lookups
 * (`getOrder`, `getTicket`, etc.) that happened in a previous turn and now live only in message
 * history, not in the current HTTP request's chunk stream.
 */
export function extractToolResultsFromMessages(messages: UIMessage[]): unknown[] {
  const results: unknown[] = []
  for (const message of messages) {
    for (const part of message.parts) {
      if ((part.type === 'dynamic-tool' || part.type.startsWith('tool-')) && 'state' in part && part.state === 'output-available' && 'output' in part) {
        results.push(part.output)
      }
    }
  }
  return results
}

/**
 * Consumes a UI message chunk stream, forwarding every non-text chunk immediately and
 * unmodified (preserving order, ids, and timing — this is what the tool-approval flow and the
 * live tool-activity indicator depend on). `text-start` / `text-delta` / `text-end` chunks are
 * buffered instead of forwarded live; once the stream ends, the concatenated text is run
 * through a self-check pass (only when the trigger condition is met) and the final text is
 * written through as a single text-start/text-delta/text-end sequence, reusing the first
 * text-start chunk's id.
 *
 * See design spec §5.3 / LLD §8 for the trigger condition and LLD §11 for the retry-once/
 * escalate algorithm.
 */
export async function runSelfCheckStream({ chunks, writer, runSelfCheck, reviseAnswer, priorToolResults = [] }: RunSelfCheckStreamOptions): Promise<void> {
  let textId: string | null = null
  let bufferedText = ''
  // M1: `finish` must not be forwarded live like the other non-text chunks — it's buffered and
  // written through last (after the final text), so the wire order is always
  // "all non-text/non-finish chunks live, then text, then finish." Relying on `finish` being
  // forwarded before the checked text (as this used to do) only worked because the AI SDK
  // client's `finish` handling happens to be non-terminal in the installed version.
  let finishChunk: UIMessageChunk | null = null
  const toolResultsThisTurn: unknown[] = []
  const toolNamesThisTurn: string[] = []

  for await (const chunk of chunks) {
    if (chunk.type === 'text-start' || chunk.type === 'text-delta' || chunk.type === 'text-end') {
      // M2: multi-step text is deliberately merged into a single part under the first
      // text-start chunk's id seen this turn — see the doc comment above — not a bug.
      if (textId === null) textId = chunk.id
      if (chunk.type === 'text-delta') bufferedText += chunk.delta
      continue
    }
    if (chunk.type === 'finish') {
      finishChunk = chunk
      continue
    }
    if (chunk.type === 'tool-output-available') toolResultsThisTurn.push(chunk.output)
    if (chunk.type === 'tool-input-available') toolNamesThisTurn.push(chunk.toolName)
    writer.write(chunk)
  }

  // A turn can legitimately have zero text (e.g. it ended awaiting tool approval). Nothing to
  // check or emit in that case — but the buffered `finish` chunk (if any) still needs to reach
  // the client.
  if (bufferedText.length === 0) {
    if (finishChunk) writer.write(finishChunk)
    return
  }

  // I7: every direct answer carries a confidence badge (design spec §5.4) — written alongside,
  // not instead of, the text, in every branch below including the escalation branch.
  const emit = (text: string, outcome: SelfCheckOutcome, allToolResultsForLabel: unknown[]) => {
    writer.write({ type: 'text-start', id: textId! })
    writer.write({ type: 'text-delta', id: textId!, delta: text })
    writer.write({ type: 'text-end', id: textId! })
    writer.write({ type: 'data-confidence', id: `${textId}-confidence`, data: { label: classifyConfidence(outcome, allToolResultsForLabel) } })
    if (finishChunk) writer.write(finishChunk)
  }

  // I9: prior-turn tool results (e.g. read-only lookups from before a tool-approval resend) are
  // combined with this turn's own tool results so the self-check pass — and any revision it
  // triggers — has visibility into everything that grounded the answer, not just what happened
  // to appear in this HTTP request's chunk stream.
  const allToolResults = [...priorToolResults, ...toolResultsThisTurn]

  const calledActionTool = toolNamesThisTurn.some(name => ACTION_TOOL_NAMES.has(name))
  const hasNumber = /\d/.test(bufferedText)
  const shouldSelfCheck = bufferedText.length > 0 && (calledActionTool || hasNumber)

  if (!shouldSelfCheck) {
    emit(bufferedText, 'not-checked', allToolResults)
    return
  }

  const firstCheck = await runSelfCheck(bufferedText, allToolResults)
  if (firstCheck.pass) {
    emit(bufferedText, 'passed', allToolResults)
    return
  }

  const revised = await reviseAnswer(bufferedText, firstCheck.issues, allToolResults)
  const secondCheck = await runSelfCheck(revised, allToolResults)
  if (secondCheck.pass) {
    emit(revised, 'revised', allToolResults)
    return
  }

  emit(SELF_CHECK_ESCALATION_MESSAGE, 'escalated', allToolResults)
}
