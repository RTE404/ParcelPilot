import { describe, it, expect, vi, beforeEach } from 'vitest'

// `route.ts` cannot be exercised end-to-end here: it ultimately calls the live Gemini API via
// `streamText`, and there is no API key configured in this environment (true for every prior
// task touching this route). Instead we mock every collaborator and assert that `POST` wires
// them together correctly: the auth guard, the exact `streamText` config, and — most
// importantly — that `execute` hands `runSelfCheckStream` the live (unbuffered) chunk source,
// the writer, and delegate functions that forward to `runSelfCheck` / `generateText` with the
// exact repair prompt specified by the design. The chunk-buffering/self-check/retry/escalation
// algorithm itself is covered in isolation by `lib/agent/__tests__/selfCheckStream.test.ts`.

const streamTextMock = vi.fn()
const generateTextMock = vi.fn()
const createUIMessageStreamMock = vi.fn()
const createUIMessageStreamResponseMock = vi.fn()

vi.mock('ai', async importOriginal => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    streamText: (...args: unknown[]) => streamTextMock(...args),
    generateText: (...args: unknown[]) => generateTextMock(...args),
    createUIMessageStream: (...args: unknown[]) => createUIMessageStreamMock(...args),
    createUIMessageStreamResponse: (...args: unknown[]) => createUIMessageStreamResponseMock(...args),
  }
})

vi.mock('@ai-sdk/google', () => ({ google: (modelId: string) => ({ modelId, __stub: 'google-model' }) }))
vi.mock('@/lib/identity/session', () => ({ getSessionIdentity: vi.fn() }))
vi.mock('@/lib/agent/tools', () => ({ createReadOnlyTools: vi.fn(() => ({ readOnlyStub: {} })) }))
vi.mock('@/lib/agent/actionTools', () => ({ createActionTools: vi.fn(() => ({ actionStub: {} })) }))
vi.mock('@/lib/agent/systemPrompt', () => ({ SYSTEM_PROMPT: 'you are a support agent' }))
vi.mock('@/lib/agent/selfCheck', () => ({ runSelfCheck: vi.fn() }))

const runSelfCheckStreamMock = vi.fn()
vi.mock('@/lib/agent/selfCheckStream', () => ({ runSelfCheckStream: (...args: unknown[]) => runSelfCheckStreamMock(...args) }))

import { getSessionIdentity } from '@/lib/identity/session'
import { runSelfCheck } from '@/lib/agent/selfCheck'
import { POST } from '../route'

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify(body) })
}

describe('POST /api/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 and never touches the model when there is no session', async () => {
    vi.mocked(getSessionIdentity).mockResolvedValue(null)

    const res = await POST(jsonRequest({ messages: [] }))

    expect(res.status).toBe(401)
    expect(streamTextMock).not.toHaveBeenCalled()
    expect(createUIMessageStreamMock).not.toHaveBeenCalled()
  })

  it('passes the live toUIMessageStream() source and the writer straight through to runSelfCheckStream unmodified', async () => {
    vi.mocked(getSessionIdentity).mockResolvedValue({ surface: 'customer', accountId: 'ACCT-001' })

    const fakeChunkStream = (async function* () {})()
    const toUIMessageStreamMock = vi.fn().mockReturnValue(fakeChunkStream)
    streamTextMock.mockReturnValue({ toUIMessageStream: toUIMessageStreamMock })
    createUIMessageStreamMock.mockImplementation(({ execute }: { execute: (o: { writer: unknown }) => Promise<void> }) => ({ execute }))
    createUIMessageStreamResponseMock.mockReturnValue(new Response(null, { status: 200 }))

    await POST(jsonRequest({ messages: [] }))

    expect(streamTextMock).toHaveBeenCalledTimes(1)
    expect(streamTextMock.mock.calls[0][0]).toMatchObject({
      system: 'you are a support agent',
      tools: { readOnlyStub: {}, actionStub: {} },
    })

    expect(createUIMessageStreamMock).toHaveBeenCalledTimes(1)
    const { execute } = createUIMessageStreamMock.mock.calls[0][0]

    const fakeWriter = { write: vi.fn() }
    await execute({ writer: fakeWriter })

    // `toUIMessageStream()`, NOT `fullStream` — this is the source that carries the
    // tool-approval chunk shapes the human-in-the-loop flow depends on.
    expect(toUIMessageStreamMock).toHaveBeenCalledTimes(1)
    expect(runSelfCheckStreamMock).toHaveBeenCalledTimes(1)
    const call = runSelfCheckStreamMock.mock.calls[0][0]
    expect(call.chunks).toBe(fakeChunkStream)
    expect(call.writer).toBe(fakeWriter)

    expect(createUIMessageStreamResponseMock).toHaveBeenCalledWith({ stream: { execute } })
  })

  it("the runSelfCheck delegate forwards to lib/agent/selfCheck's runSelfCheck with the configured model", async () => {
    vi.mocked(getSessionIdentity).mockResolvedValue({ surface: 'customer', accountId: 'ACCT-001' })
    streamTextMock.mockReturnValue({ toUIMessageStream: () => (async function* () {})() })
    createUIMessageStreamMock.mockImplementation(({ execute }: { execute: (o: { writer: unknown }) => Promise<void> }) => ({ execute }))
    createUIMessageStreamResponseMock.mockReturnValue(new Response(null, { status: 200 }))
    vi.mocked(runSelfCheck).mockResolvedValue({ pass: true, issues: [] })

    await POST(jsonRequest({ messages: [] }))
    const { execute } = createUIMessageStreamMock.mock.calls[0][0]
    await execute({ writer: { write: vi.fn() } })

    const call = runSelfCheckStreamMock.mock.calls[0][0]
    const result = await call.runSelfCheck('draft answer', [{ orderId: 'ORD-1' }])

    expect(result).toEqual({ pass: true, issues: [] })
    expect(runSelfCheck).toHaveBeenCalledWith('draft answer', [{ orderId: 'ORD-1' }], expect.objectContaining({ __stub: 'google-model' }))
  })

  it('the reviseAnswer delegate calls generateText with the exact repair prompt text specified by the design', async () => {
    vi.mocked(getSessionIdentity).mockResolvedValue({ surface: 'customer', accountId: 'ACCT-001' })
    streamTextMock.mockReturnValue({ toUIMessageStream: () => (async function* () {})() })
    createUIMessageStreamMock.mockImplementation(({ execute }: { execute: (o: { writer: unknown }) => Promise<void> }) => ({ execute }))
    createUIMessageStreamResponseMock.mockReturnValue(new Response(null, { status: 200 }))
    generateTextMock.mockResolvedValue({ text: 'revised answer text' })

    await POST(jsonRequest({ messages: [] }))
    const { execute } = createUIMessageStreamMock.mock.calls[0][0]
    await execute({ writer: { write: vi.fn() } })

    const call = runSelfCheckStreamMock.mock.calls[0][0]
    const revised = await call.reviseAnswer('the buffered draft', ['issue A', 'issue B'], [{ creditInr: 240 }])

    expect(revised).toBe('revised answer text')
    expect(generateTextMock).toHaveBeenCalledTimes(1)
    const genArgs = generateTextMock.mock.calls[0][0]
    expect(genArgs.model).toMatchObject({ __stub: 'google-model' })
    expect(genArgs.prompt).toBe(
      'You previously drafted this answer to a support query:\n"""\nthe buffered draft\n"""\n\n' +
        'A review found these issues:\nissue A\nissue B\n\n' +
        'Revise the answer to fix these issues, using ONLY these tool results from this turn as ' +
        'your source of facts — do not invent anything not present here:\n' +
        JSON.stringify([{ creditInr: 240 }], null, 2) +
        '\n\nReturn only the revised answer text, nothing else.',
    )
  })
})
