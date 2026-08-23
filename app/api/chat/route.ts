import { google } from '@ai-sdk/google'
import { streamText, generateText, convertToModelMessages, stepCountIs, createUIMessageStream, createUIMessageStreamResponse, validateUIMessages } from 'ai'
import type { UIMessage } from 'ai'
import { getSessionIdentity } from '@/lib/identity/session'
import { createReadOnlyTools } from '@/lib/agent/tools'
import { createActionTools } from '@/lib/agent/actionTools'
import { SYSTEM_PROMPT } from '@/lib/agent/systemPrompt'
import { runSelfCheck } from '@/lib/agent/selfCheck'
import { runSelfCheckStream } from '@/lib/agent/selfCheckStream'

export const maxDuration = 30

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

  const stream = createUIMessageStream({
    execute: async ({ writer }) =>
      runSelfCheckStream({
        // NOT result.fullStream — the UI message stream is what carries the tool-approval
        // chunk shapes (tool-input-available, tool-approval-request, tool-output-available,
        // tool-output-denied, etc.) that the human-in-the-loop flow depends on unmodified.
        chunks: result.toUIMessageStream(),
        writer,
        runSelfCheck: (draftAnswer, toolResultsThisTurn) => runSelfCheck(draftAnswer, toolResultsThisTurn, google(MODEL_ID)),
        reviseAnswer: async (bufferedText, issues, toolResultsThisTurn) => {
          const { text } = await generateText({
            model: google(MODEL_ID),
            prompt: `You previously drafted this answer to a support query:\n"""\n${bufferedText}\n"""\n\nA review found these issues:\n${issues.join('\n')}\n\nRevise the answer to fix these issues, using ONLY these tool results from this turn as your source of facts — do not invent anything not present here:\n${JSON.stringify(toolResultsThisTurn, null, 2)}\n\nReturn only the revised answer text, nothing else.`,
          })
          return text
        },
      }),
  })

  return createUIMessageStreamResponse({ stream })
}
