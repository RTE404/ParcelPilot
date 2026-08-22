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

export async function runSelfCheck(draftAnswer: string, toolResultsThisTurn: unknown[], model: LanguageModel): Promise<SelfCheckResult> {
  const { text } = await generateText({ model, prompt: SELF_CHECK_PROMPT(draftAnswer, toolResultsThisTurn) })
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed.pass === 'boolean' && Array.isArray(parsed.issues)) {
      return { pass: parsed.pass, issues: parsed.issues }
    }
    return { pass: false, issues: ['self-check response was not in the expected shape'] }
  } catch {
    return { pass: false, issues: ['self-check response was not valid JSON'] }
  }
}
