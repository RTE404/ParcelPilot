import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { traceSpan } from '../traceSpan'

describe('traceSpan', () => {
  const originalFetch = global.fetch
  const originalEnv = { ...process.env }

  beforeEach(() => { global.fetch = vi.fn(async () => new Response('{}', { status: 200 })) })
  afterEach(() => { global.fetch = originalFetch; process.env = { ...originalEnv } })

  it('returns the wrapped function\'s result unchanged', async () => {
    const result = await traceSpan('test.span', {}, async () => 42)
    expect(result).toBe(42)
  })

  it('does not call fetch when EVAL_ENDPOINT is unset', async () => {
    delete process.env.EVAL_ENDPOINT
    await traceSpan('test.span', {}, async () => 'ok')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('calls fetch with the span payload when EVAL_ENDPOINT is set', async () => {
    process.env.EVAL_ENDPOINT = 'http://localhost:8000'
    process.env.EVAL_API_KEY = 'test-key'
    await traceSpan('test.span', { tool: 'documentSearch' }, async () => 'ok')
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('http://localhost:8000'),
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'X-API-Key': 'test-key' }) }),
    )
  })

  it('propagates the wrapped function\'s error and still reports it, without throwing from the tracer itself', async () => {
    process.env.EVAL_ENDPOINT = 'http://localhost:8000'
    await expect(traceSpan('test.span', {}, async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(global.fetch).toHaveBeenCalled()
  })

  it('never lets a fetch failure break the wrapped function\'s result', async () => {
    process.env.EVAL_ENDPOINT = 'http://localhost:8000'
    global.fetch = vi.fn(async () => { throw new Error('network down') })
    const result = await traceSpan('test.span', {}, async () => 'still works')
    expect(result).toBe('still works')
  })
})
