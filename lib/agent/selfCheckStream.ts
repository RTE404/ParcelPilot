import type { UIMessageChunk } from 'ai'
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
export async function runSelfCheckStream({ chunks, writer, runSelfCheck, reviseAnswer }: RunSelfCheckStreamOptions): Promise<void> {
  let textId: string | null = null
  let bufferedText = ''
  const toolResultsThisTurn: unknown[] = []
  const toolNamesThisTurn: string[] = []

  for await (const chunk of chunks) {
    if (chunk.type === 'text-start' || chunk.type === 'text-delta' || chunk.type === 'text-end') {
      if (textId === null) textId = chunk.id
      if (chunk.type === 'text-delta') bufferedText += chunk.delta
      continue
    }
    if (chunk.type === 'tool-output-available') toolResultsThisTurn.push(chunk.output)
    if (chunk.type === 'tool-input-available') toolNamesThisTurn.push(chunk.toolName)
    writer.write(chunk)
  }

  // A turn can legitimately have zero text (e.g. it ended awaiting tool approval). Nothing to
  // check or emit in that case.
  if (bufferedText.length === 0) return

  const emit = (text: string) => {
    writer.write({ type: 'text-start', id: textId! })
    writer.write({ type: 'text-delta', id: textId!, delta: text })
    writer.write({ type: 'text-end', id: textId! })
  }

  const calledActionTool = toolNamesThisTurn.some(name => ACTION_TOOL_NAMES.has(name))
  const hasNumber = /\d/.test(bufferedText)
  const shouldSelfCheck = bufferedText.length > 0 && (calledActionTool || hasNumber)

  if (!shouldSelfCheck) {
    emit(bufferedText)
    return
  }

  const firstCheck = await runSelfCheck(bufferedText, toolResultsThisTurn)
  if (firstCheck.pass) {
    emit(bufferedText)
    return
  }

  const revised = await reviseAnswer(bufferedText, firstCheck.issues, toolResultsThisTurn)
  const secondCheck = await runSelfCheck(revised, toolResultsThisTurn)
  if (secondCheck.pass) {
    emit(revised)
    return
  }

  emit(SELF_CHECK_ESCALATION_MESSAGE)
}
