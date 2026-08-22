import { describe, it, expect } from 'vitest'
import { runSelfCheck } from '../selfCheck'
import type { LanguageModel } from 'ai'

function stubModel(responseText: string): LanguageModel {
  return {
    specificationVersion: 'v2',
    provider: 'stub',
    modelId: 'stub-model',
    supportedUrls: {},
    async doGenerate() {
      return {
        content: [{ type: 'text', text: responseText }],
        finishReason: 'stop',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        warnings: [],
      }
    },
  } as unknown as LanguageModel
}

describe('runSelfCheck', () => {
  it('passes when the model reports no issues', async () => {
    const model = stubModel(JSON.stringify({ pass: true, issues: [] }))
    const result = await runSelfCheck('No fee — per Northstar\'s contract.', [{ feeWaived: true }], model)
    expect(result.pass).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('fails and surfaces issues when the model reports a mismatch', async () => {
    const model = stubModel(JSON.stringify({ pass: false, issues: ['claimed amount not present in any tool result'] }))
    const result = await runSelfCheck('Credit is ₹9,999.', [{ creditInr: 240 }], model)
    expect(result.pass).toBe(false)
    expect(result.issues).toContain('claimed amount not present in any tool result')
  })

  it('fails closed (treats as failing) if the model response is not valid JSON', async () => {
    const model = stubModel('not json at all')
    const result = await runSelfCheck('Some answer.', [], model)
    expect(result.pass).toBe(false)
  })

  it('parses correctly when the model wraps its JSON in a markdown code fence', async () => {
    const model = stubModel('```json\n{"pass": true, "issues": []}\n```')
    const result = await runSelfCheck('No fee — per Northstar\'s contract.', [{ feeWaived: true }], model)
    expect(result.pass).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('parses correctly when a fenced response reports a real failure', async () => {
    const model = stubModel('```json\n{\n  "pass": false,\n  "issues": ["not grounded"]\n}\n```')
    const result = await runSelfCheck('Credit is ₹9,999.', [{ creditInr: 240 }], model)
    expect(result.pass).toBe(false)
    expect(result.issues).toContain('not grounded')
  })

  it('fails closed (does not throw) if the self-check model call itself throws', async () => {
    const model = {
      specificationVersion: 'v2',
      provider: 'stub',
      modelId: 'stub-model',
      supportedUrls: {},
      async doGenerate() {
        throw new Error('network error')
      },
    } as unknown as LanguageModel
    const result = await runSelfCheck('Some answer.', [], model)
    expect(result.pass).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
  })
})
