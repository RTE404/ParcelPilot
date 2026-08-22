import { describe, it, expect, vi } from 'vitest'
import { runSelfCheckStream, SELF_CHECK_ESCALATION_MESSAGE } from '../selfCheckStream'
import type { UIMessageChunk } from 'ai'
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
    // Non-text chunks (here, `finish`) are forwarded live during iteration; the buffered text
    // is only emitted after the source stream ends, so it lands after `finish` in write order.
    expect(written).toEqual([
      { type: 'start' },
      { type: 'finish' },
      { type: 'text-start', id: 'txt_1' },
      { type: 'text-delta', id: 'txt_1', delta: 'Your package is on its way, no issues found.' },
      { type: 'text-end', id: 'txt_1' },
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
})
