import { google } from '@ai-sdk/google'
import { streamText, generateText, convertToModelMessages, stepCountIs, createUIMessageStream, createUIMessageStreamResponse, validateUIMessages } from 'ai'
import type { UIMessage } from 'ai'
import { getSessionIdentity } from '@/lib/identity/session'
import { createReadOnlyTools } from '@/lib/agent/tools'
import { createActionTools } from '@/lib/agent/actionTools'
import { SYSTEM_PROMPT } from '@/lib/agent/systemPrompt'
import { runSelfCheck } from '@/lib/agent/selfCheck'
import { runSelfCheckStream, extractToolResultsFromMessages } from '@/lib/agent/selfCheckStream'

// A turn can involve up to 8 tool-calling steps plus up to three additional model calls
// (self-check, revise, re-check) — 30s was tight for that full chain in the worst case.
export const maxDuration = 60

const MODEL_ID = process.env.PARCELPILOT_MODEL_ID ?? 'gemini-3.5-flash-lite'

export async function POST(req: Request) {
  const session = await getSessionIdentity()
  if (!session) {
    return new Response('Not logged in', { status: 401 })
  }

  let messages: UIMessage[]
  try {
    const body = await req.json()
    messages = await validateUIMessages({ messages: body.messages })
  } catch {
    return new Response('Invalid request body', { status: 400 })
  }

  const result = streamText({
    model: google(MODEL_ID),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages, { ignoreIncompleteToolCalls: true }),
    tools: { ...createReadOnlyTools(session), ...createActionTools(session) },
    stopWhen: stepCountIs(8),
    experimental_toolApprovalSecret: process.env.TOOL_APPROVAL_SECRET ?? 'parcelpilot-dev-secret-change-in-production',
  })

  // I9: read-only lookups from earlier turns (getOrder, getTicket, etc.) live only in message
  // history once a tool-approval resend means this turn's own chunk stream carries just the
  // just-approved action tool's output. Extracted here, before/independent of
  // convertToModelMessages, so the self-check pass isn't limited to this turn's thin evidence.
  const priorToolResults = extractToolResultsFromMessages(messages)

  const stream = createUIMessageStream({
    execute: async ({ writer }) =>
      runSelfCheckStream({
        // NOT result.fullStream — the UI message stream is what carries the tool-approval
        // chunk shapes (tool-input-available, tool-approval-request, tool-output-available,
        // tool-output-denied, etc.) that the human-in-the-loop flow depends on unmodified.
        chunks: result.toUIMessageStream(),
        writer,
        priorToolResults,
        runSelfCheck: (draftAnswer, toolResultsThisTurn) => runSelfCheck(draftAnswer, toolResultsThisTurn, google(MODEL_ID)),
        reviseAnswer: async (bufferedText, issues, toolResultsThisTurn) => {
          const { text } = await generateText({
            model: google(MODEL_ID),
            prompt: `You previously drafted this answer to a support query:\n"""\n${bufferedText}\n"""\n\nA review found these issues:\n${issues.join('\n')}\n\nRevise the answer to fix these issues, using ONLY these tool results from this conversation as your source of facts — do not invent anything not present here:\n${JSON.stringify(toolResultsThisTurn, null, 2)}\n\nReturn only the revised answer text, nothing else.`,
          })
          return text
        },
      }),
  })

  return createUIMessageStreamResponse({ stream })
}
