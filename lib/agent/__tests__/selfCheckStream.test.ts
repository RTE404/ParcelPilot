import { describe, it, expect, vi } from 'vitest'
import { runSelfCheckStream, extractToolResultsFromMessages, classifyConfidence, SELF_CHECK_ESCALATION_MESSAGE, STEP_CAP_ESCALATION_MESSAGE } from '../selfCheckStream'
import type { UIMessageChunk, UIMessage } from 'ai'
import type { SelfCheckResult } from '../selfCheck'

async function* streamOf(chunks: UIMessageChunk[]): AsyncIterable<UIMessageChunk> {
  for (const chunk of chunks) yield chunk
}

function collectingWriter() {
  const written: UIMessageChunk[] = []
  return { writer: { write: (chunk: UIMessageChunk) => written.push(chunk) }, written }
}

function textChunks(id: string, text: string): UIMessageChunk[] {
  return [
    { type: 'text-start', id },
    { type: 'text-delta', id, delta: text },
    { type: 'text-end', id },
  ]
}

describe('runSelfCheckStream', () => {
  it('(a) forwards every non-text chunk unmodified and in arrival order, without triggering self-check', async () => {
    // Includes trailing text so this exercises the ordinary answer path, not the zero-text
    // branch — a chunk stream with tool activity but no text and no approval request is now the
    // step-cap-exhaustion case (see test (f) below), which is a deliberately different scenario.
    const nonTextChunks: UIMessageChunk[] = [
      { type: 'start' },
      { type: 'start-step' },
      { type: 'tool-input-available', toolCallId: 'call_1', toolName: 'getOrder', input: { orderId: 'ORD-1' } },
      { type: 'tool-output-available', toolCallId: 'call_1', output: { orderId: 'ORD-1', status: 'shipped' } },
      { type: 'finish-step' },
    ]
    const chunks: UIMessageChunk[] = [...nonTextChunks, ...textChunks('txt_1', 'Your order has shipped.'), { type: 'finish' }]
    const { writer, written } = collectingWriter()
    const runSelfCheck = vi.fn()
    const reviseAnswer = vi.fn()

    await runSelfCheckStream({ chunks: streamOf(chunks), writer, runSelfCheck, reviseAnswer })

    expect(written.slice(0, nonTextChunks.length)).toEqual(nonTextChunks)
    expect(runSelfCheck).not.toHaveBeenCalled()
    expect(reviseAnswer).not.toHaveBeenCalled()
  })

  it('preserves order when tool chunks and an approval-flow chunk are interleaved, forwarding each unchanged', async () => {
    const chunks: UIMessageChunk[] = [
      { type: 'start' },
      { type: 'tool-input-available', toolCallId: 'call_1', toolName: 'approveCredit', input: {} },
      { type: 'tool-approval-request', approvalId: 'appr_1', toolCallId: 'call_1' },
      { type: 'finish' },
    ]
    const { writer, written } = collectingWriter()

    await runSelfCheckStream({
      chunks: streamOf(chunks),
      writer,
      runSelfCheck: vi.fn(),
      reviseAnswer: vi.fn(),
    })

    expect(written).toEqual(chunks)
  })

  it('(b) a turn with no digits and no action-tool call skips self-check and emits the original text unmodified', async () => {
    const chunks: UIMessageChunk[] = [
      { type: 'start' },
      ...textChunks('txt_1', 'Your package is on its way, no issues found.'),
      { type: 'finish' },
    ]
    const { writer, written } = collectingWriter()
    const runSelfCheck = vi.fn()
    const reviseAnswer = vi.fn()

    await runSelfCheckStream({ chunks: streamOf(chunks), writer, runSelfCheck, reviseAnswer })

    expect(runSelfCheck).not.toHaveBeenCalled()
    expect(reviseAnswer).not.toHaveBeenCalled()
    // M1: `finish` is buffered (not forwarded live like other non-text chunks) and written
    // through only after the final text, so the wire order is always
    // non-text/non-finish chunks, then text, then finish — protocol-conformant regardless of
    // client leniency around a `finish` chunk arriving before the message's text.
    // I7: a not-checked answer with no override-citation signal gets a 'High' confidence badge.
    expect(written).toEqual([
      { type: 'start' },
      { type: 'text-start', id: 'txt_1' },
      { type: 'text-delta', id: 'txt_1', delta: 'Your package is on its way, no issues found.' },
      { type: 'text-end', id: 'txt_1' },
      { type: 'data-confidence', id: 'txt_1-confidence', data: { label: 'High' } },
      { type: 'finish' },
    ])
  })

  it('a turn containing a digit runs self-check even without an action tool call', async () => {
    const chunks: UIMessageChunk[] = [...textChunks('txt_1', 'Your refund is ₹500.'), { type: 'finish' }]
    const { writer, written } = collectingWriter()
    const runSelfCheck = vi.fn<(draft: string, results: unknown[]) => Promise<SelfCheckResult>>().mockResolvedValue({ pass: true, issues: [] })
    const reviseAnswer = vi.fn()

    await runSelfCheckStream({ chunks: streamOf(chunks), writer, runSelfCheck, reviseAnswer })

    expect(runSelfCheck).toHaveBeenCalledTimes(1)
    expect(runSelfCheck).toHaveBeenCalledWith('Your refund is ₹500.', [])
    expect(reviseAnswer).not.toHaveBeenCalled()
    expect(written.filter(c => c.type === 'text-delta')).toEqual([{ type: 'text-delta', id: 'txt_1', delta: 'Your refund is ₹500.' }])
    // I7: a first-try-pass answer with no tool results at all gets a 'High' confidence badge.
    expect(written).toContainEqual({ type: 'data-confidence', id: 'txt_1-confidence', data: { label: 'High' } })
  })

  it('a turn that calls an action tool runs self-check even with no digits in the text', async () => {
    const chunks: UIMessageChunk[] = [
      { type: 'tool-input-available', toolCallId: 'call_1', toolName: 'createEscalation', input: {} },
      { type: 'tool-output-available', toolCallId: 'call_1', output: { escalationId: 'ESC-1' } },
      ...textChunks('txt_1', 'I have escalated this to the team.'),
      { type: 'finish' },
    ]
    const { writer } = collectingWriter()
    const runSelfCheck = vi.fn<(draft: string, results: unknown[]) => Promise<SelfCheckResult>>().mockResolvedValue({ pass: true, issues: [] })

    await runSelfCheckStream({ chunks: streamOf(chunks), writer, runSelfCheck, reviseAnswer: vi.fn() })

    expect(runSelfCheck).toHaveBeenCalledWith('I have escalated this to the team.', [{ escalationId: 'ESC-1' }])
  })

  it('(c) a turn that fails self-check once then passes on retry emits the revised text', async () => {
    const chunks: UIMessageChunk[] = [
      { type: 'tool-output-available', toolCallId: 'call_1', output: { creditInr: 240 } },
      ...textChunks('txt_1', 'Your credit is ₹9,999.'),
      { type: 'finish' },
    ]
    const { writer, written } = collectingWriter()

    const runSelfCheck = vi
      .fn<(draft: string, results: unknown[]) => Promise<SelfCheckResult>>()
      .mockResolvedValueOnce({ pass: false, issues: ['claimed amount not present in any tool result'] })
      .mockResolvedValueOnce({ pass: true, issues: [] })
    const reviseAnswer = vi.fn().mockResolvedValue('Your credit is ₹240.')

    await runSelfCheckStream({ chunks: streamOf(chunks), writer, runSelfCheck, reviseAnswer })

    expect(runSelfCheck).toHaveBeenCalledTimes(2)
    expect(reviseAnswer).toHaveBeenCalledTimes(1)
    expect(reviseAnswer).toHaveBeenCalledWith(
      'Your credit is ₹9,999.',
      ['claimed amount not present in any tool result'],
      [{ creditInr: 240 }],
    )
    // second check runs against the revised text
    expect(runSelfCheck).toHaveBeenNthCalledWith(2, 'Your credit is ₹240.', [{ creditInr: 240 }])
    expect(written.filter(c => c.type === 'text-delta')).toEqual([{ type: 'text-delta', id: 'txt_1', delta: 'Your credit is ₹240.' }])
    // I7: a revised (one-retry) answer gets a 'Low' confidence badge — the tool result here has
    // no citation/escalate field, so only the 'revised' outcome drives the label.
    expect(written).toContainEqual({ type: 'data-confidence', id: 'txt_1-confidence', data: { label: 'Low' } })
  })

  it('(d) a turn that fails self-check twice emits the fixed escalation message', async () => {
    const chunks: UIMessageChunk[] = [...textChunks('txt_1', 'Your credit is ₹9,999.'), { type: 'finish' }]
    const { writer, written } = collectingWriter()

    const runSelfCheck = vi
      .fn<(draft: string, results: unknown[]) => Promise<SelfCheckResult>>()
      .mockResolvedValueOnce({ pass: false, issues: ['bad'] })
      .mockResolvedValueOnce({ pass: false, issues: ['still bad'] })
    const reviseAnswer = vi.fn().mockResolvedValue('Your credit is still wrong.')

    await runSelfCheckStream({ chunks: streamOf(chunks), writer, runSelfCheck, reviseAnswer })

    expect(runSelfCheck).toHaveBeenCalledTimes(2)
    expect(reviseAnswer).toHaveBeenCalledTimes(1)
    expect(written).toContainEqual({ type: 'text-delta', id: 'txt_1', delta: SELF_CHECK_ESCALATION_MESSAGE })
    // the never-verified drafts must not leak through
    expect(written.some(c => c.type === 'text-delta' && c.delta.includes('₹9,999'))).toBe(false)
    expect(written.some(c => c.type === 'text-delta' && c.delta.includes('still wrong'))).toBe(false)
    // M1: `finish` must be deferred until after the escalation text in this branch too — not
    // just the happy path (test (b)) — otherwise a future edit could silently regress
    // protocol-conformance in exactly the branch a hasty fix would forget to check.
    // I7: an escalated turn still gets a confidence badge — 'Escalated', not omitted.
    expect(written).toEqual([
      { type: 'text-start', id: 'txt_1' },
      { type: 'text-delta', id: 'txt_1', delta: SELF_CHECK_ESCALATION_MESSAGE },
      { type: 'text-end', id: 'txt_1' },
      { type: 'data-confidence', id: 'txt_1-confidence', data: { label: 'Escalated' } },
      { type: 'finish' },
    ])
  })

  it('(e) a turn with zero text chunks emits nothing extra beyond the forwarded chunks', async () => {
    const chunks: UIMessageChunk[] = [
      { type: 'start' },
      { type: 'tool-input-available', toolCallId: 'call_1', toolName: 'approveCredit', input: {} },
      { type: 'tool-approval-request', approvalId: 'appr_1', toolCallId: 'call_1' },
      { type: 'finish' },
    ]
    const { writer, written } = collectingWriter()
    const runSelfCheck = vi.fn()
    const reviseAnswer = vi.fn()

    await runSelfCheckStream({ chunks: streamOf(chunks), writer, runSelfCheck, reviseAnswer })

    expect(written).toEqual(chunks)
    expect(written.some(c => c.type.startsWith('text-'))).toBe(false)
    expect(runSelfCheck).not.toHaveBeenCalled()
    expect(reviseAnswer).not.toHaveBeenCalled()
  })

  it('(f) a turn that exhausts the step cap (no approval request seen), zero text, emits the step-cap escalation fallback', async () => {
    const chunks: UIMessageChunk[] = [
      { type: 'start' },
      { type: 'tool-input-available', toolCallId: 'call_1', toolName: 'getTicket', input: { ticketId: 'TKT-503' } },
      { type: 'tool-output-available', toolCallId: 'call_1', output: { ticketId: 'TKT-503', status: 'open' } },
      { type: 'tool-input-available', toolCallId: 'call_2', toolName: 'searchDocuments', input: { query: 'change billing contact' } },
      { type: 'tool-output-available', toolCallId: 'call_2', output: { results: [] } },
      { type: 'tool-input-available', toolCallId: 'call_3', toolName: 'getAccount', input: { accountId: 'ACC-1' } },
      { type: 'tool-output-available', toolCallId: 'call_3', output: { accountId: 'ACC-1', plan: 'Enterprise' } },
      { type: 'finish', finishReason: 'tool-calls' },
    ]
    const { writer, written } = collectingWriter()
    const runSelfCheck = vi.fn()
    const reviseAnswer = vi.fn()

    await runSelfCheckStream({ chunks: streamOf(chunks), writer, runSelfCheck, reviseAnswer })

    expect(runSelfCheck).not.toHaveBeenCalled()
    expect(reviseAnswer).not.toHaveBeenCalled()
    expect(written).toEqual([
      { type: 'start' },
      { type: 'tool-input-available', toolCallId: 'call_1', toolName: 'getTicket', input: { ticketId: 'TKT-503' } },
      { type: 'tool-output-available', toolCallId: 'call_1', output: { ticketId: 'TKT-503', status: 'open' } },
      { type: 'tool-input-available', toolCallId: 'call_2', toolName: 'searchDocuments', input: { query: 'change billing contact' } },
      { type: 'tool-output-available', toolCallId: 'call_2', output: { results: [] } },
      { type: 'tool-input-available', toolCallId: 'call_3', toolName: 'getAccount', input: { accountId: 'ACC-1' } },
      { type: 'tool-output-available', toolCallId: 'call_3', output: { accountId: 'ACC-1', plan: 'Enterprise' } },
      { type: 'text-start', id: 'step-cap-fallback' },
      { type: 'text-delta', id: 'step-cap-fallback', delta: STEP_CAP_ESCALATION_MESSAGE },
      { type: 'text-end', id: 'step-cap-fallback' },
      { type: 'data-confidence', id: 'step-cap-fallback-confidence', data: { label: 'Escalated' } },
      { type: 'finish', finishReason: 'tool-calls' },
    ])
  })

  it('reuses the first-seen text-start id even when text arrives in multiple spans across the turn', async () => {
    const chunks: UIMessageChunk[] = [
      { type: 'text-start', id: 'txt_1' },
      { type: 'text-delta', id: 'txt_1', delta: 'Before the tool call, ' },
      { type: 'text-end', id: 'txt_1' },
      { type: 'tool-input-available', toolCallId: 'call_1', toolName: 'getOrder', input: {} },
      { type: 'tool-output-available', toolCallId: 'call_1', output: { orderId: 'ORD-1' } },
      { type: 'text-start', id: 'txt_2' },
      { type: 'text-delta', id: 'txt_2', delta: 'and after it too.' },
      { type: 'text-end', id: 'txt_2' },
      { type: 'finish' },
    ]
    const { writer, written } = collectingWriter()

    await runSelfCheckStream({ chunks: streamOf(chunks), writer, runSelfCheck: vi.fn(), reviseAnswer: vi.fn() })

    const emitted = written.filter(c => c.type.startsWith('text-'))
    expect(emitted).toEqual([
      { type: 'text-start', id: 'txt_1' },
      { type: 'text-delta', id: 'txt_1', delta: 'Before the tool call, and after it too.' },
      { type: 'text-end', id: 'txt_1' },
    ])
  })

  // I9: prior-turn tool results must reach both the self-check and revise calls, combined with
  // whatever this turn's own chunk stream contributed — not just the (possibly empty) current
  // turn's results.
  it('(I9) combines priorToolResults with this turn\'s tool results when calling runSelfCheck and reviseAnswer', async () => {
    const chunks: UIMessageChunk[] = [...textChunks('txt_1', 'Your credit is ₹240.'), { type: 'finish' }]
    const { writer } = collectingWriter()
    const priorToolResults = [{ orderId: 'ORD-1', status: 'shipped' }, { ticketId: 'TKT-1' }]

    const runSelfCheck = vi
      .fn<(draft: string, results: unknown[]) => Promise<SelfCheckResult>>()
      .mockResolvedValueOnce({ pass: false, issues: ['needs revision'] })
      .mockResolvedValueOnce({ pass: true, issues: [] })
    const reviseAnswer = vi.fn().mockResolvedValue('Your credit is ₹240 (revised).')

    await runSelfCheckStream({ chunks: streamOf(chunks), writer, runSelfCheck, reviseAnswer, priorToolResults })

    // No tool-output-available chunks appeared in this turn's stream, so the only way these
    // prior results can reach the calls below is via `priorToolResults`.
    expect(runSelfCheck).toHaveBeenNthCalledWith(1, 'Your credit is ₹240.', priorToolResults)
    expect(reviseAnswer).toHaveBeenCalledWith('Your credit is ₹240.', ['needs revision'], priorToolResults)
    expect(runSelfCheck).toHaveBeenNthCalledWith(2, 'Your credit is ₹240 (revised).', priorToolResults)
  })

  it('(I9) defaults priorToolResults to empty when omitted, preserving prior behavior', async () => {
    const chunks: UIMessageChunk[] = [...textChunks('txt_1', 'Your refund is ₹500.'), { type: 'finish' }]
    const { writer } = collectingWriter()
    const runSelfCheck = vi.fn<(draft: string, results: unknown[]) => Promise<SelfCheckResult>>().mockResolvedValue({ pass: true, issues: [] })

    await runSelfCheckStream({ chunks: streamOf(chunks), writer, runSelfCheck, reviseAnswer: vi.fn() })

    expect(runSelfCheck).toHaveBeenCalledWith('Your refund is ₹500.', [])
  })
})

describe('classifyConfidence', () => {
  it('(I7) returns Escalated when any tool result carries a truthy escalate field, even on a passed outcome', () => {
    expect(classifyConfidence('passed', [{ creditInr: 5000, escalate: 'EXCEEDS_APPROVAL_LIMIT' }])).toBe('Escalated')
  })

  it('(I7) returns Escalated when the self-check outcome itself escalated, even with no escalate-flagged tool result', () => {
    expect(classifyConfidence('escalated', [{ creditInr: 240, citation: '03_Cancellation_and_Service_Credit_SOP_v4.pdf, Section 2' }])).toBe('Escalated')
  })

  it('(I7) returns Resolved conflict for a contract-specific citation with no escalate flag on a first-try-pass outcome', () => {
    expect(classifyConfidence('passed', [{ creditInr: 800, citation: '05_Northstar_Logistics_Enterprise_Agreement.pdf' }])).toBe('Resolved conflict')
  })

  it('(I7) returns Low for a plain default-SOP citation with a revised outcome', () => {
    expect(classifyConfidence('revised', [{ creditInr: 240, citation: '03_Cancellation_and_Service_Credit_SOP_v4.pdf, Section 2' }])).toBe('Low')
  })

  it('(I7) returns High for a plain default-SOP citation with a passed outcome', () => {
    expect(classifyConfidence('passed', [{ creditInr: 240, citation: '03_Cancellation_and_Service_Credit_SOP_v4.pdf, Section 2' }])).toBe('High')
  })

  it('(I7) returns High for a plain default-policy citation with a not-checked outcome', () => {
    expect(classifyConfidence('not-checked', [{ severity: 'P2', citation: '01_Support_Policy_v3_CURRENT.pdf, Section 3' }])).toBe('High')
  })

  it('(I7) ignores non-plain-object tool results and results without a citation/escalate field', () => {
    expect(classifyConfidence('passed', [null, 'raw string', 42, [1, 2], { orderId: 'ORD-1' }])).toBe('High')
  })

  it('(I7) priority order: Escalated beats Resolved conflict when both signals are present', () => {
    expect(classifyConfidence('passed', [{ creditInr: 5000, escalate: 'EXCEEDS_APPROVAL_LIMIT', citation: '05_Northstar_Logistics_Enterprise_Agreement.pdf' }])).toBe('Escalated')
  })

  it('(I7) priority order: Resolved conflict beats Low when both signals are present', () => {
    expect(classifyConfidence('revised', [{ creditInr: 800, citation: '05_Northstar_Logistics_Enterprise_Agreement.pdf' }])).toBe('Resolved conflict')
  })
})

describe('extractToolResultsFromMessages', () => {
  it('extracts only the output of tool parts in output-available state, across all messages', () => {
    const messages: UIMessage[] = [
      {
        id: 'msg-1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Looking that up for you.' },
          { type: 'tool-getOrder', state: 'output-available', toolCallId: 'call_1', input: { orderId: 'ORD-1' }, output: { orderId: 'ORD-1', status: 'shipped' } },
          // no output yet -- must NOT be extracted
          { type: 'tool-getTicket', state: 'input-available', toolCallId: 'call_2', input: { ticketId: 'TKT-1' } },
        ],
      } as UIMessage,
      {
        id: 'msg-2',
        role: 'assistant',
        parts: [
          { type: 'dynamic-tool', toolName: 'approveCredit', state: 'output-available', toolCallId: 'call_3', input: {}, output: { creditInr: 240 } },
        ],
      } as UIMessage,
    ]

    const results = extractToolResultsFromMessages(messages)

    expect(results).toEqual([{ orderId: 'ORD-1', status: 'shipped' }, { creditInr: 240 }])
  })

  it('returns an empty array when no message contains an output-available tool part', () => {
    const messages: UIMessage[] = [
      { id: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'hello' }] } as UIMessage,
    ]

    expect(extractToolResultsFromMessages(messages)).toEqual([])
  })
})
