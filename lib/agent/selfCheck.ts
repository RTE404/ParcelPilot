import { generateText } from 'ai'
import type { LanguageModel } from 'ai'

export interface SelfCheckResult {
  pass: boolean
  issues: string[]
}

const SELF_CHECK_PROMPT = (draftAnswer: string, toolResults: unknown[]) => `You are reviewing a draft support-agent answer before it is shown to a user.

Draft answer:
"""
${draftAnswer}
"""

Tool results produced this turn (the only facts this answer is allowed to rely on):
${JSON.stringify(toolResults, null, 2)}

Check two things:
1. Citation accuracy — does every cited source actually support the specific claim made about it?
2. Grounding — does every specific fact in the draft (an ID, date, or amount) literally appear in the tool results above, rather than being invented?

Respond with ONLY a JSON object: {"pass": boolean, "issues": string[]}. If everything checks out, return {"pass": true, "issues": []}.`

// Some models (observed: gemini-3.5-flash-lite) wrap JSON output in a markdown code fence
// despite being asked for "ONLY a JSON object" — strip it before parsing, don't fail closed
// on formatting the prompt already asked the model not to use.
function stripCodeFence(text: string): string {
  const match = text.trim().match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/)
  return match ? match[1] : text
}

export async function runSelfCheck(draftAnswer: string, toolResultsThisTurn: unknown[], model: LanguageModel): Promise<SelfCheckResult> {
  try {
    const { text } = await generateText({ model, prompt: SELF_CHECK_PROMPT(draftAnswer, toolResultsThisTurn) })
    const parsed = JSON.parse(stripCodeFence(text))
    if (typeof parsed.pass === 'boolean' && Array.isArray(parsed.issues)) {
      return { pass: parsed.pass, issues: parsed.issues }
    }
    return { pass: false, issues: ['self-check response was not in the expected shape'] }
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { pass: false, issues: ['self-check response was not valid JSON'] }
    }
    return { pass: false, issues: ['self-check model call failed'] }
  }
}
