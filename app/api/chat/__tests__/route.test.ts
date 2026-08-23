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
const extractToolResultsFromMessagesMock = vi.fn()
vi.mock('@/lib/agent/selfCheckStream', () => ({
  runSelfCheckStream: (...args: unknown[]) => runSelfCheckStreamMock(...args),
  extractToolResultsFromMessages: (...args: unknown[]) => extractToolResultsFromMessagesMock(...args),
}))

import { getSessionIdentity } from '@/lib/identity/session'
import { runSelfCheck } from '@/lib/agent/selfCheck'
import { POST } from '../route'

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify(body) })
}

// `validateUIMessages` (added for I3) rejects an empty `messages` array ("Messages array must
// not be empty"), so wiring tests that need to reach `streamText` can no longer use `[]` as
// filler — use this minimal valid history instead.
const MINIMAL_VALID_MESSAGES = [{ id: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }]

describe('POST /api/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    extractToolResultsFromMessagesMock.mockReturnValue([])
  })

  it('returns 401 and never touches the model when there is no session', async () => {
    vi.mocked(getSessionIdentity).mockResolvedValue(null)

    const res = await POST(jsonRequest({ messages: MINIMAL_VALID_MESSAGES }))

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

    await POST(jsonRequest({ messages: MINIMAL_VALID_MESSAGES }))

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

  // I9: prior-turn tool results (extracted from the raw `messages` array) must reach
  // `runSelfCheckStream` as `priorToolResults`, so the self-check pass has visibility into
  // read-only lookups from earlier turns, not just this turn's chunk stream.
  it('extracts prior-turn tool results from messages and passes them to runSelfCheckStream as priorToolResults', async () => {
    vi.mocked(getSessionIdentity).mockResolvedValue({ surface: 'customer', accountId: 'ACCT-001' })
    streamTextMock.mockReturnValue({ toUIMessageStream: () => (async function* () {})() })
    createUIMessageStreamMock.mockImplementation(({ execute }: { execute: (o: { writer: unknown }) => Promise<void> }) => ({ execute }))
    createUIMessageStreamResponseMock.mockReturnValue(new Response(null, { status: 200 }))
    const priorResults = [{ orderId: 'ORD-1', status: 'shipped' }]
    extractToolResultsFromMessagesMock.mockReturnValue(priorResults)

    await POST(jsonRequest({ messages: MINIMAL_VALID_MESSAGES }))
    const { execute } = createUIMessageStreamMock.mock.calls[0][0]
    await execute({ writer: { write: vi.fn() } })

    expect(extractToolResultsFromMessagesMock).toHaveBeenCalledWith(MINIMAL_VALID_MESSAGES)
    expect(runSelfCheckStreamMock).toHaveBeenCalledTimes(1)
    expect(runSelfCheckStreamMock.mock.calls[0][0].priorToolResults).toBe(priorResults)
  })

  it("the runSelfCheck delegate forwards to lib/agent/selfCheck's runSelfCheck with the configured model", async () => {
    vi.mocked(getSessionIdentity).mockResolvedValue({ surface: 'customer', accountId: 'ACCT-001' })
    streamTextMock.mockReturnValue({ toUIMessageStream: () => (async function* () {})() })
    createUIMessageStreamMock.mockImplementation(({ execute }: { execute: (o: { writer: unknown }) => Promise<void> }) => ({ execute }))
    createUIMessageStreamResponseMock.mockReturnValue(new Response(null, { status: 200 }))
    vi.mocked(runSelfCheck).mockResolvedValue({ pass: true, issues: [] })

    await POST(jsonRequest({ messages: MINIMAL_VALID_MESSAGES }))
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

    await POST(jsonRequest({ messages: MINIMAL_VALID_MESSAGES }))
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
        'Revise the answer to fix these issues, using ONLY these tool results from this conversation as ' +
        'your source of facts — do not invent anything not present here:\n' +
        JSON.stringify([{ creditInr: 240 }], null, 2) +
        '\n\nReturn only the revised answer text, nothing else.',
    )
  })

  // C1: an unanswered tool-approval-request part must not permanently brick the thread.
  // Without `{ ignoreIncompleteToolCalls: true }`, an assistant message containing an
  // unresolved tool call (no matching tool-result / approval-response) survives
  // `convertToModelMessages` and later trips `MissingToolResultsError` deeper inside
  // `streamText`'s own prompt-standardization step once a later user message follows it — a
  // real network call, not something this mocked-streamText test can observe directly. What
  // this test CAN observe (and does) is the fix's actual effect one layer up: with the option
  // set, `convertToModelMessages` (the real implementation — it's not one of the mocked
  // exports from 'ai' in this file) drops the entire assistant message carrying the unanswered
  // approval-requested part, so it never reaches `streamText` at all. Confirmed by traced SDK
  // source in the report.
  it('drops an assistant message that only contains an unanswered approval-request part before it reaches streamText', async () => {
    vi.mocked(getSessionIdentity).mockResolvedValue({ surface: 'customer', accountId: 'ACCT-001' })
    streamTextMock.mockReturnValue({ toUIMessageStream: () => (async function* () {})() })
    createUIMessageStreamMock.mockImplementation(({ execute }: { execute: (o: { writer: unknown }) => Promise<void> }) => ({ execute }))
    createUIMessageStreamResponseMock.mockReturnValue(new Response(null, { status: 200 }))

    const historyWithUnansweredApproval = [
      {
        id: 'msg-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-createEscalation',
            state: 'approval-requested',
            toolCallId: 'call-1',
            input: { reason: 'test' },
            approval: { id: 'approval-1' },
          },
        ],
      },
      {
        id: 'msg-2',
        role: 'user',
        parts: [{ type: 'text', text: 'never mind, something else' }],
      },
    ]

    await POST(jsonRequest({ messages: historyWithUnansweredApproval }))

    expect(streamTextMock).toHaveBeenCalledTimes(1)
    const streamTextArgs = streamTextMock.mock.calls[0][0]
    // Only the trailing user text message should survive — the assistant message whose only
    // part was the unanswered approval request is gone, and no tool-call/tool-approval-request
    // content reaches the model.
    expect(streamTextArgs.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'never mind, something else' }] }])
  })

  // I2: the server must sign tool-approval-request chunks so a forged request body can't
  // fabricate an approval and get an action tool to execute without a human round-trip.
  it('passes a non-empty experimental_toolApprovalSecret to streamText', async () => {
    vi.mocked(getSessionIdentity).mockResolvedValue({ surface: 'customer', accountId: 'ACCT-001' })
    streamTextMock.mockReturnValue({ toUIMessageStream: () => (async function* () {})() })
    createUIMessageStreamMock.mockImplementation(({ execute }: { execute: (o: { writer: unknown }) => Promise<void> }) => ({ execute }))
    createUIMessageStreamResponseMock.mockReturnValue(new Response(null, { status: 200 }))

    await POST(jsonRequest({ messages: MINIMAL_VALID_MESSAGES }))

    expect(streamTextMock).toHaveBeenCalledTimes(1)
    const streamTextArgs = streamTextMock.mock.calls[0][0]
    expect(typeof streamTextArgs.experimental_toolApprovalSecret).toBe('string')
    expect(streamTextArgs.experimental_toolApprovalSecret.length).toBeGreaterThan(0)
  })

  // I3: a malformed body must return a clean 400, never 500, and must never reach streamText.
  it('returns 400 (not 500) and never calls streamText when the body has no messages array', async () => {
    vi.mocked(getSessionIdentity).mockResolvedValue({ surface: 'customer', accountId: 'ACCT-001' })

    const res = await POST(jsonRequest({}))

    expect(res.status).toBe(400)
    expect(streamTextMock).not.toHaveBeenCalled()
  })

  it('returns 400 (not 500) when messages is not an array', async () => {
    vi.mocked(getSessionIdentity).mockResolvedValue({ surface: 'customer', accountId: 'ACCT-001' })

    const res = await POST(jsonRequest({ messages: 'not-an-array' }))

    expect(res.status).toBe(400)
    expect(streamTextMock).not.toHaveBeenCalled()
  })

  it('returns 400 (not 500) when the request body is not valid JSON', async () => {
    vi.mocked(getSessionIdentity).mockResolvedValue({ surface: 'customer', accountId: 'ACCT-001' })

    const res = await POST(new Request('http://localhost/api/chat', { method: 'POST', body: '{not json' }))

    expect(res.status).toBe(400)
    expect(streamTextMock).not.toHaveBeenCalled()
  })
})
