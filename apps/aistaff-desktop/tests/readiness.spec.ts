import { describe, expect, it } from 'vitest'
import { MAX_RUNTIME_LINE_BYTES, parseReadinessLine, ReadinessDecoder } from '../src/readiness.js'

describe('DSH readiness validation', () => {
  it('accepts only the exact loopback readiness line', () => {
    expect(parseReadinessLine('dsh web: http://127.0.0.1:43129')?.href)
      .toBe('http://127.0.0.1:43129/')
    expect(parseReadinessLine('unrelated log output')).toBeUndefined()
  })

  it.each([
    'dsh web: http://localhost:43129',
    'dsh web: http://0.0.0.0:43129',
    'dsh web: http://[::1]:43129',
    'dsh web: https://127.0.0.1:43129',
    'dsh web: http://127.0.0.1:0',
    'dsh web: http://127.0.0.1:65536',
    'dsh web: http://127.0.0.1:043129',
    'dsh web: http://127.0.0.1:43129/path',
    'dsh web: http://127.0.0.1:43129?token=x',
    'dsh web: http://127.0.0.1:43129 trailing',
  ])('rejects unsafe or inexact readiness output: %s', (line) => {
    expect(() => parseReadinessLine(line)).toThrow('Invalid DSH readiness')
  })

  it('decodes a readiness line split across chunks', () => {
    const decoder = new ReadinessDecoder()
    expect(decoder.push(Buffer.from('booting\ndsh web: http://127.'))).toBeUndefined()
    expect(decoder.push(Buffer.from('0.0.1:52100\r\n'))?.href).toBe('http://127.0.0.1:52100/')
  })

  it('rejects an unbounded stdout line', () => {
    const decoder = new ReadinessDecoder()
    expect(() => decoder.push(Buffer.alloc(MAX_RUNTIME_LINE_BYTES + 1, 0x61)))
      .toThrow('exceeded the readiness limit')
  })
})
