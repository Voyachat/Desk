import { describe, expect, it } from 'vitest'
import {
  displayFailureMessage, projectFailureDisplay,
} from '../src/client/sessions/failure-display.ts'

describe('model failure display projection', () => {
  it.each([
    ['QUOTA', 'quota'],
    ['RATE_LIMIT', 'rate-limit'],
    ['AUTH', 'auth'],
    ['TRANSPORT', 'network'],
    ['EAI_AGAIN', 'network'],
    ['TIMEOUT', 'timeout'],
    ['LLM_STREAM_IDLE_TIMEOUT', 'timeout'],
    ['SERVER', 'provider-unavailable'],
    ['CONTEXT_WINDOW_EXCEEDED', 'context-window'],
    ['INVALID_REQUEST', 'invalid-request'],
    ['UNSUPPORTED_OPTION', 'configuration'],
    ['UNSUPPORTED_REASONING_EFFORT', 'configuration'],
    ['UNKNOWN_MODEL', 'configuration'],
    ['NO_ADAPTER', 'configuration'],
    ['PI_AI_ERROR', 'unknown'],
  ] as const)('classifies %s without parsing provider prose', (code, category) => {
    expect(projectFailureDisplay({ code, message: 'provider prose is irrelevant' }).category).toBe(category)
  })

  it.each([
    [401, 'auth'],
    [402, 'quota'],
    [408, 'timeout'],
    [429, 'rate-limit'],
    [503, 'provider-unavailable'],
    [400, 'invalid-request'],
    [422, 'invalid-request'],
  ] as const)('falls back to HTTP %s when the stable code is unknown', (status, category) => {
    expect(projectFailureDisplay({ code: 'UNKNOWN', status }).category).toBe(category)
  })

  it('classifies an HTTP code and emits only bounded structured diagnostics', () => {
    const raw = '{"error":{"code":429,"message":"quota for key AIza-secret-token exhausted"}}'
    const display = projectFailureDisplay({
      code: 'RATE_LIMIT',
      status: 429,
      providerRetryAfterMs: 1_250.2,
      requestId: 'req_abc-123',
      message: raw,
    })

    expect(display).toEqual({
      category: 'rate-limit',
      diagnostic: 'Code: RATE_LIMIT · HTTP: 429 · Retry-After: 1251ms · Request ID: req_abc-123',
      retryAfterMs: 1_250.2,
    })
    expect(JSON.stringify(display)).not.toContain('AIza-secret-token')
    expect(JSON.stringify(display)).not.toContain('{"error"')
    expect(displayFailureMessage({ code: 'HTTP_504', message: raw })).toBe('Code: HTTP_504 · HTTP: 504')
  })

  it('drops malformed fields and never stringifies arbitrary failure values', () => {
    const malformed = projectFailureDisplay({
      code: 'raw provider body',
      status: 999,
      providerRetryAfterMs: -1,
      requestId: 'contains whitespace',
      message: 'sk-secret',
    })
    expect(malformed).toEqual({ category: 'unknown', diagnostic: 'Code: UNKNOWN' })
    expect(projectFailureDisplay('sk-primitive-secret')).toEqual({
      category: 'unknown',
      diagnostic: 'Code: UNKNOWN',
    })
  })

  it('contains a hostile failure object without invoking its accessors', () => {
    const accessor = { get code(): never { throw new Error('must not run') } }
    expect(projectFailureDisplay(accessor)).toEqual({ category: 'unknown', diagnostic: 'Code: UNKNOWN' })

    const proxy = new Proxy({}, {
      getOwnPropertyDescriptor: () => { throw new Error('hostile descriptor trap') },
    })
    expect(projectFailureDisplay(proxy)).toEqual({ category: 'unknown', diagnostic: 'Code: UNKNOWN' })
  })
})
