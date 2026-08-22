interface SpanReport {
  name: string
  meta: Record<string, unknown>
  status: 'ok' | 'error'
  durationMs: number
  error?: string
}

function reportSpan(span: SpanReport): void {
  const endpoint = process.env.EVAL_ENDPOINT
  if (!endpoint) return
  fetch(`${endpoint}/api/v1/runs/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': process.env.EVAL_API_KEY ?? '' },
    body: JSON.stringify(span),
  }).catch(() => { /* tracing must never affect the caller */ })
}

export async function traceSpan<T>(name: string, meta: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
  const start = Date.now()
  try {
    const result = await fn()
    reportSpan({ name, meta, status: 'ok', durationMs: Date.now() - start })
    return result
  } catch (err) {
    reportSpan({ name, meta, status: 'error', durationMs: Date.now() - start, error: String(err) })
    throw err
  }
}
