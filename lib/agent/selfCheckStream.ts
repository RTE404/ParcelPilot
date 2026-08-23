import type { UIMessage, UIMessageChunk } from 'ai'
import type { SelfCheckResult } from './selfCheck'

/** Tool names whose invocation this turn forces a self-check pass regardless of digit content. */
export const ACTION_TOOL_NAMES = new Set(['createEscalation', 'updateTicketSeverity', 'approveCredit', 'createFollowupTask'])

export const SELF_CHECK_ESCALATION_MESSAGE =
  "I wasn't able to verify this answer against the available data with enough confidence to present it, so I'm escalating this for a team member to review directly rather than risk giving you incorrect information."

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

  const emit = (text: string) => {
    writer.write({ type: 'text-start', id: textId! })
    writer.write({ type: 'text-delta', id: textId!, delta: text })
    writer.write({ type: 'text-end', id: textId! })
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
    emit(bufferedText)
    return
  }

  const firstCheck = await runSelfCheck(bufferedText, allToolResults)
  if (firstCheck.pass) {
    emit(bufferedText)
    return
  }

  const revised = await reviseAnswer(bufferedText, firstCheck.issues, allToolResults)
  const secondCheck = await runSelfCheck(revised, allToolResults)
  if (secondCheck.pass) {
    emit(revised)
    return
  }

  emit(SELF_CHECK_ESCALATION_MESSAGE)
}
