/**
 * Credential and endpoint composition for the SDK child environment.
 */

import { describe, expect, it } from 'vitest'
import { claudeChildEnv, type ResolvedConfig } from '../src/index.ts'

function config(patch: Partial<ResolvedConfig>): ResolvedConfig {
  return {
    runtime: 'claude',
    permissionMode: 'default',
    env: {},
    disposeGraceMs: 1000,
    ...patch,
  }
}

describe('claudeChildEnv', () => {
  it('maps endpoint fields onto the ANTHROPIC variables', () => {
    const env = claudeChildEnv(config({
      baseUrl: 'https://gateway.example.com',
      authToken: 'token-123',
      apiKey: 'key-456',
      model: 'claude-sonnet-4-5',
    }))
    expect(env['ANTHROPIC_BASE_URL']).toBe('https://gateway.example.com')
    expect(env['ANTHROPIC_AUTH_TOKEN']).toBe('token-123')
    expect(env['ANTHROPIC_API_KEY']).toBe('key-456')
    expect(env['ANTHROPIC_MODEL']).toBe('claude-sonnet-4-5')
  })

  it('omits unset endpoint fields', () => {
    const env = claudeChildEnv(config({ baseUrl: 'https://gateway.example.com' }))
    expect(env['ANTHROPIC_AUTH_TOKEN']).toBeUndefined()
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined()
    expect(env['ANTHROPIC_MODEL']).toBeUndefined()
  })

  it('layers explicit deployment env over the scrubbed parent', () => {
    const env = claudeChildEnv(config({ env: { DSH_TEST_MARKER: 'on', PATH: '/opt/custom' } }))
    expect(env['DSH_TEST_MARKER']).toBe('on')
    expect(env['PATH']).toBe('/opt/custom')
  })
})
