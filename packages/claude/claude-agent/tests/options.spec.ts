/**
 * Credential and endpoint composition for the SDK child environment.
 */

import { describe, expect, it } from 'vitest'
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import type { SessionEvent } from '@voyaseek-ai/dsh-session'
import { claudeChildEnv, claudePermissionMode, claudePermissionResult, type ResolvedConfig } from '../src/index.ts'

function config(patch: Partial<ResolvedConfig>): ResolvedConfig {
  return {
    runtime: 'claude',
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

function permissionEvents(sandbox: 'read-only' | 'workspace-write' | 'danger-full-access', approval: 'ask' | 'never'): readonly SessionEvent[] {
  return [
    { type: 'sandbox/mode', data: { mode: sandbox } },
    { type: 'approval/policy', data: { policy: approval } },
  ] as unknown as readonly SessionEvent[]
}

describe('claudePermissionMode', () => {
  it('bypasses SDK checks for the DSH full-access no-prompt preset', () => {
    expect(claudePermissionMode(permissionEvents('danger-full-access', 'never'))).toBe('bypassPermissions')
  })

  it('accepts workspace edits while retaining approval for other SDK permission requests', () => {
    expect(claudePermissionMode(permissionEvents('workspace-write', 'ask'))).toBe('acceptEdits')
  })

  it('uses the default posture for read-only or unmatched combinations', () => {
    expect(claudePermissionMode(permissionEvents('danger-full-access', 'ask'))).toBe('default')
    expect(claudePermissionMode(permissionEvents('read-only', 'never'))).toBe('default')
    expect(claudePermissionMode(permissionEvents('read-only', 'ask'))).toBe('default')
  })

  it('honors an explicit deployment permission mode', () => {
    expect(claudePermissionMode(permissionEvents('danger-full-access', 'never'), 'plan')).toBe('plan')
  })
})

describe('claudePermissionResult', () => {
  const input = { file_path: '/workspace/game.html' }
  const suggestions: PermissionUpdate[] = [
    {
      type: 'addRules',
      rules: [{ toolName: 'Write', ruleContent: '/workspace/**' }],
      behavior: 'allow',
      destination: 'session',
    },
    { type: 'addDirectories', directories: ['/workspace'], destination: 'session' },
  ]

  it('keeps a one-shot grant one-shot', () => {
    expect(claudePermissionResult('allowed-once', input, suggestions))
      .toEqual({ behavior: 'allow', updatedInput: input })
  })

  it('returns every SDK suggestion unchanged for a remembered grant', () => {
    expect(claudePermissionResult('allowed-and-remembered', input, suggestions))
      .toEqual({ behavior: 'allow', updatedInput: input, updatedPermissions: suggestions })
  })

  it('fails closed when a remembered grant has no SDK-authored rule', () => {
    expect(claudePermissionResult('allowed-and-remembered', input, []))
      .toMatchObject({ behavior: 'deny' })
    expect(claudePermissionResult('allowed-and-remembered', input, undefined))
      .toMatchObject({ behavior: 'deny' })
  })
})
