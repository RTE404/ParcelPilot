import { describe, it, expect, vi } from 'vitest'
import { runSelfCheckStream, extractToolResultsFromMessages, SELF_CHECK_ESCALATION_MESSAGE } from '../selfCheckStream'
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
    const chunks: UIMessageChunk[] = [
      { type: 'start' },
      { type: 'start-step' },
      { type: 'tool-input-available', toolCallId: 'call_1', toolName: 'getOrder', input: { orderId: 'ORD-1' } },
      { type: 'tool-output-available', toolCallId: 'call_1', output: { orderId: 'ORD-1', status: 'shipped' } },
      { type: 'finish-step' },
      { type: 'finish' },
    ]
    const { writer, written } = collectingWriter()
    const runSelfCheck = vi.fn()
    const reviseAnswer = vi.fn()

    await runSelfCheckStream({ chunks: streamOf(chunks), writer, runSelfCheck, reviseAnswer })

    expect(written).toEqual(chunks)
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
    expect(written).toEqual([
      { type: 'start' },
      { type: 'text-start', id: 'txt_1' },
      { type: 'text-delta', id: 'txt_1', delta: 'Your package is on its way, no issues found.' },
      { type: 'text-end', id: 'txt_1' },
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
