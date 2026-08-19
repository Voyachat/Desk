import { Context } from '@voyaseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { Agent } from '@voyaseek-ai/dsh-agent'
import { configuredCodexArgv, makeCodexServerRequest, resolveCodexTurnConfig } from '../src/index.ts'

describe('codex-agent configuration', () => {
  it('configures a custom endpoint as a Responses provider without placing its key in argv', () => {
    const argv = configuredCodexArgv({
      provider: 'dashscope',
      baseUrl: 'https://dashscope.example.test/responses',
      apiKeyEnv: 'DASHSCOPE_API_KEY',
    })
    expect(argv).toEqual(expect.arrayContaining([
      'model_provider="dashscope"',
      'model_providers.dashscope.wire_api="responses"',
      'model_providers.dashscope.env_key="DASHSCOPE_API_KEY"',
    ]))
    expect(argv.join(' ')).not.toContain('secret-value')
  })

  it('resolves the credential again for every turn configuration', async () => {
    let value = 'first-value'
    const ctx = {
      get: (name: string) => name === 'credentials'
        ? { resolve: () => Promise.resolve({ value, source: 'test' }) }
        : undefined,
    } as unknown as Context
    const config = {
      runtime: 'codex',
      provider: 'dashscope',
      model: 'qwen-test',
      env: {},
      disposeGraceMs: 100,
      apiKeyEnv: 'DASHSCOPE_API_KEY',
    }
    expect((await resolveCodexTurnConfig(ctx, config)).env.DASHSCOPE_API_KEY).toBe('first-value')
    value = 'second-value'
    expect((await resolveCodexTurnConfig(ctx, config)).env.DASHSCOPE_API_KEY).toBe('second-value')
  })

  it('allows only the explicit full-access/no-prompt pair and otherwise fails closed without an approval provider', async () => {
    const ctx = new Context()
    const unrestricted = {
      session: {
        events: [
          { type: 'sandbox/mode', data: { mode: 'danger-full-access' } },
          { type: 'approval/policy', data: { policy: 'never' } },
        ],
      },
    } as unknown as Agent
    const guarded = { session: { events: [] } } as unknown as Agent
    const params = {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'command-1',
      availableDecisions: ['accept', 'decline'],
    }
    expect(await makeCodexServerRequest(ctx, unrestricted)(
      'item/commandExecution/requestApproval', params, new AbortController().signal,
    )).toEqual({ decision: 'accept' })
    expect(await makeCodexServerRequest(ctx, guarded)(
      'item/fileChange/requestApproval', params, new AbortController().signal,
    )).toEqual({ decision: 'decline' })
  })
})
