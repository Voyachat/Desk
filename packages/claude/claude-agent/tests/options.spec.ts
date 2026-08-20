/**
 * Credential and endpoint composition for the SDK child environment.
 */

import { describe, expect, it } from 'vitest'
import type { CanUseTool, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import { Context } from '@voyaseek-ai/cordis'
import AgentRegistry, { type Agent } from '@voyaseek-ai/dsh-agent'
import type { SessionEvent } from '@voyaseek-ai/dsh-session'
import UserQuestionService, { type AskUserQuestionRequest } from '@voyaseek-ai/dsh-user-questions'
import {
  claudeChildEnv,
  claudePermissionMode,
  claudePermissionResult,
  claudeRememberablePermissionUpdates,
  claudeRememberedPermissionSettings,
  makeCanUseTool,
  type ResolvedConfig,
} from '../src/index.ts'

function config(patch: Partial<ResolvedConfig>): ResolvedConfig {
  return {
    runtime: 'claude',
    provider: 'claude-agent',
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
  it('keeps the callback path for the DSH full-access no-prompt preset', () => {
    expect(claudePermissionMode(permissionEvents('danger-full-access', 'never'))).toBe('default')
  })

  it('uses classifier-backed auto review for the agent-approval preset', () => {
    expect(claudePermissionMode(permissionEvents('workspace-write', 'ask'))).toBe('auto')
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
  const suggestions: PermissionUpdate[] = [{
    type: 'addRules',
    rules: [{ toolName: 'Write', ruleContent: '/workspace/**' }],
    behavior: 'allow',
    destination: 'session',
  }]

  it('keeps a one-shot grant one-shot', () => {
    expect(claudePermissionResult('allowed-once', input, 'Write', suggestions))
      .toEqual({ behavior: 'allow', updatedInput: input })
  })

  it('returns a safe SDK suggestion unchanged for a remembered grant', () => {
    expect(claudePermissionResult('allowed-and-remembered', input, 'Write', suggestions))
      .toEqual({ behavior: 'allow', updatedInput: input, updatedPermissions: suggestions })
  })

  it('fails closed when a remembered grant has no SDK-authored rule', () => {
    expect(claudePermissionResult('allowed-and-remembered', input, 'Write', []))
      .toMatchObject({ behavior: 'deny' })
    expect(claudePermissionResult('allowed-and-remembered', input, 'Write', undefined))
      .toMatchObject({ behavior: 'deny' })
  })
})

describe('claudeRememberablePermissionUpdates', () => {
  it('accepts only an entirely session-scoped same-tool allow batch', () => {
    const safe: PermissionUpdate = {
      type: 'addRules', rules: [{ toolName: 'Write', ruleContent: '/workspace/**' }],
      behavior: 'allow', destination: 'session',
    }
    const unsafe: PermissionUpdate[] = [
      { ...safe, destination: 'userSettings' },
      { ...safe, destination: 'projectSettings' },
      { ...safe, destination: 'localSettings' },
      { ...safe, behavior: 'deny' },
      { ...safe, behavior: 'ask' },
      { type: 'setMode', mode: 'bypassPermissions', destination: 'session' },
      { type: 'addDirectories', directories: ['/'], destination: 'session' },
      { type: 'replaceRules', rules: safe.rules, behavior: 'allow', destination: 'session' },
      { type: 'removeRules', rules: safe.rules, behavior: 'allow', destination: 'session' },
      {
        type: 'addRules', rules: [{ toolName: 'Bash' }],
        behavior: 'allow', destination: 'session',
      },
    ]

    expect(claudeRememberablePermissionUpdates('Write', [safe])).toEqual([safe])
    expect(claudeRememberablePermissionUpdates('Write', [...unsafe, safe])).toEqual([])
  })
})

describe('claudeRememberedPermissionSettings', () => {
  it('carries session allow rules into the next SDK child', () => {
    const result = claudeRememberedPermissionSettings(undefined, 'mcp__browser__open', [
      {
        type: 'addRules',
        rules: [{ toolName: 'mcp__browser__open', ruleContent: 'https://example.com/**' }],
        behavior: 'allow',
        destination: 'session',
      },
    ])

    expect(result).toEqual({
      allow: ['mcp__browser__open(https://example.com/**)'],
    })
  })

  it('does not carry unsafe suggestions into the next SDK child', () => {
    expect(claudeRememberedPermissionSettings(undefined, 'Write', [
      {
        type: 'addRules', rules: [{ toolName: 'Write', ruleContent: '/workspace/**' }],
        behavior: 'allow', destination: 'userSettings',
      },
      { type: 'setMode', mode: 'bypassPermissions', destination: 'session' },
      { type: 'addDirectories', directories: ['/'], destination: 'session' },
    ])).toBeUndefined()
  })
})

function agent(id: string, events: readonly SessionEvent[] = []): Agent {
  return {
    id: id as Agent['id'],
    session: { id, header: {}, events },
  } as unknown as Agent
}

describe('makeCanUseTool', () => {
  it('routes AskUserQuestion to the question provider in full access without an approval request', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    const caller = agent('claude-question', permissionEvents('danger-full-access', 'never'))
    ctx.agents.enter(caller, undefined)
    const seen: AskUserQuestionRequest[] = []
    ctx.userQuestions.registerProvider({
      async ask(request) {
        seen.push(request)
        return {
          answers: [
            { id: 'tool-1:0', selected: ['TypeScript'] },
            { id: 'tool-1:1', selected: ['Tests'], custom: 'Docs' },
          ],
        }
      },
    })
    const bridge = makeCanUseTool(ctx, caller)
    const options = {
      signal: new AbortController().signal,
      toolUseID: 'tool-1',
    } as Parameters<CanUseTool>[2]

    const result = await bridge.canUseTool('AskUserQuestion', {
      questions: [
        {
          question: 'Which language?', header: 'Language', multiSelect: false,
          options: [
            { label: 'TypeScript', description: 'Use TypeScript.' },
            { label: 'JavaScript', description: 'Use JavaScript.' },
          ],
        },
        {
          question: 'Which outputs?', header: 'Outputs', multiSelect: true,
          options: [
            { label: 'Tests', description: 'Add tests.' },
            { label: 'Docs', description: 'Add documentation.' },
          ],
        },
      ],
    }, options)

    expect(seen).toEqual([{
      agent: caller,
      signal: options.signal,
      questions: [
        {
          id: 'tool-1:0', question: 'Which language?', header: 'Language', multiSelect: false,
          options: [
            { label: 'TypeScript', description: 'Use TypeScript.' },
            { label: 'JavaScript', description: 'Use JavaScript.' },
          ],
        },
        {
          id: 'tool-1:1', question: 'Which outputs?', header: 'Outputs', multiSelect: true,
          options: [
            { label: 'Tests', description: 'Add tests.' },
            { label: 'Docs', description: 'Add documentation.' },
          ],
        },
      ],
    }])
    expect(result).toEqual({
      behavior: 'allow',
      updatedInput: {
        questions: expect.any(Array),
        answers: {
          'Which language?': 'TypeScript',
          'Which outputs?': 'Tests, Docs',
        },
      },
    })
  })

  it('advertises and carries only safe session allow-rule suggestions', async () => {
    const caller = agent('claude-permission')
    const requests: Array<{ rememberable?: true }> = []
    let outcome: 'allowed-once' | 'allowed-and-remembered' = 'allowed-once'
    const ctx = {
      get(name: string) {
        if (name !== 'approval') return undefined
        return {
          async request(request: { rememberable?: true }) {
            requests.push(request)
            return outcome
          },
        }
      },
    } as unknown as Context
    const bridge = makeCanUseTool(ctx, caller)
    const unsafe: PermissionUpdate[] = [
      {
        type: 'addRules', rules: [{ toolName: 'mcp__browser__open' }],
        behavior: 'allow', destination: 'projectSettings',
      },
      { type: 'setMode', mode: 'bypassPermissions', destination: 'session' },
      { type: 'addDirectories', directories: ['/'], destination: 'session' },
    ]
    const safe: PermissionUpdate = {
      type: 'addRules', rules: [{ toolName: 'mcp__browser__open', ruleContent: 'https://example.com/**' }],
      behavior: 'allow', destination: 'session',
    }
    const permissionOptions = (suggestions: PermissionUpdate[]) => ({
      signal: new AbortController().signal,
      toolUseID: 'browser-1',
      suggestions,
    }) as Parameters<CanUseTool>[2]

    await bridge.canUseTool('mcp__browser__open', { url: 'https://example.com' }, permissionOptions(unsafe))
    expect(requests[0]).not.toHaveProperty('rememberable')
    expect(bridge.permissionSettings()).toBeUndefined()

    outcome = 'allowed-and-remembered'
    const mixedResult = await bridge.canUseTool(
      'mcp__browser__open',
      { url: 'https://example.com' },
      permissionOptions([...unsafe, safe]),
    )
    expect(requests[1]).not.toHaveProperty('rememberable')
    expect(mixedResult).toMatchObject({ behavior: 'deny' })
    expect(bridge.permissionSettings()).toBeUndefined()

    const result = await bridge.canUseTool(
      'mcp__browser__open',
      { url: 'https://example.com' },
      permissionOptions([safe]),
    )
    expect(requests[2]).toMatchObject({ rememberable: true })
    expect(result).toMatchObject({ behavior: 'allow', updatedPermissions: [safe] })
    expect(bridge.permissionSettings()).toEqual({
      allow: ['mcp__browser__open(https://example.com/**)'],
    })
  })

  it('directly allows non-question tools for the full-access no-prompt pair', async () => {
    const caller = agent('claude-full-access', permissionEvents('danger-full-access', 'never'))
    const ctx = { get: () => { throw new Error('no service should be consulted') } } as unknown as Context
    const bridge = makeCanUseTool(ctx, caller)

    await expect(bridge.canUseTool('Bash', { command: 'pwd' }, {
      signal: new AbortController().signal,
      toolUseID: 'bash-1',
    } as Parameters<CanUseTool>[2])).resolves.toEqual({
      behavior: 'allow',
      updatedInput: { command: 'pwd' },
    })
  })
})
