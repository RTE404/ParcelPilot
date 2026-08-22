import { google } from '@ai-sdk/google'
import { streamText, convertToModelMessages, stepCountIs } from 'ai'
import type { UIMessage } from 'ai'
import { getSessionIdentity } from '@/lib/identity/session'
import { createReadOnlyTools } from '@/lib/agent/tools'
import { createActionTools } from '@/lib/agent/actionTools'
import { SYSTEM_PROMPT } from '@/lib/agent/systemPrompt'

export const maxDuration = 30

const MODEL_ID = process.env.PARCELPILOT_MODEL_ID ?? 'gemini-2.5-flash-lite'

export async function POST(req: Request) {
  const session = await getSessionIdentity()
  if (!session) {
    return new Response('Not logged in', { status: 401 })
  }

  const { messages }: { messages: UIMessage[] } = await req.json()

  const result = streamText({
    model: google(MODEL_ID),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: { ...createReadOnlyTools(session), ...createActionTools(session) },
    stopWhen: stepCountIs(8),
  })

  return result.toUIMessageStreamResponse()
}
