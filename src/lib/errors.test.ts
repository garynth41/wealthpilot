import { describe, it, expect, beforeEach } from 'vitest'
import { captureError, setErrorSink, _errorState } from './errors'
describe('error capture', () => {
  beforeEach(() => { _errorState.reset(); localStorage.clear() })
  it('sends to the sink with version, page and stack; the same message is deduplicated for a minute', async () => {
    const got: unknown[] = []; setErrorSink(async r => { got.push(r) })
    expect(captureError(new Error('boom'), { where: 'test' })).toBe(true)
    expect(captureError(new Error('boom'))).toBe(false)
    expect(captureError('other')).toBe(true)
    await new Promise(r => setTimeout(r, 0))
    expect(got).toHaveLength(2); const r = got[0] as { message: string; version: string; source: string; stack: string; context: { where: string } }
    expect(r.message).toBe('boom'); expect(r.source).toBe('browser'); expect(r.version).toMatch(/^\d+\.\d+\.\d+$/); expect(r.stack).toContain('boom'); expect(r.context.where).toBe('test')
    setErrorSink(null)
  })
  it('caps at 20 reports per session and queues in localStorage when there is no sink yet', () => {
    setErrorSink(null)
    for (let i = 0; i < 25; i++) captureError(new Error('e' + i))
    expect(_errorState.sent).toBe(20)
    expect(JSON.parse(localStorage.getItem('wealthpilot.errors.pending') || '[]')).toHaveLength(10)   // keeps the last 10
  })
})
