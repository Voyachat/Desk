/**
 * Real-composition coverage: the plugin mounts beside the loop and routes
 * runtime-selected sessions through the SDK driver without starting any CLI
 * process at creation time.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@voyaseek-ai/cordis'
import AgentRegistry from '@voyaseek-ai/dsh-agent'
import AgentLoop from '@voyaseek-ai/dsh-agent-loop'
import LlmRuntime from '@voyaseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@voyaseek-ai/dsh-session'
import LocalSubprocessRuntime from '@voyaseek-ai/dsh-subprocess-local'
import SystemPrompt from '@voyaseek-ai/dsh-system-prompt'
import ToolRuntime from '@voyaseek-ai/dsh-tools'
import * as claudeAgent from '../src/index.ts'
import { ClaudeSdkAgent } from '../src/driver.ts'

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(claudeAgent, {
    baseUrl: 'https://gateway.example.test',
    authToken: 'test-token',
    model: 'claude-test-model',
  })
  return ctx
}

describe('claude-agent loader composition', () => {
  it('registers the claude runtime beside the default loop', async () => {
    const ctx = await harness()
    expect(ctx.agentLoop.driverRuntimes()).toEqual(['claude'])
  })

  it('serves runtime-selected sessions through the SDK driver', async () => {
    const ctx = await harness()
    const handle = await ctx.agents.create({
      sessionId: SessionId('claude-composed'),
      meta: { cwd: '/tmp/claude-composed', agentRuntime: 'claude' },
    })
    expect(handle.agent).toBeInstanceOf(ClaudeSdkAgent)
    expect(handle.agent.session.header.agentRuntime).toBe('claude')
    expect(handle.agent.status).toBe('idle')
    await handle.dispose()
    expect(ctx.agents.get(SessionId('claude-composed'))).toBeUndefined()
  })

  it('keeps unnamed sessions on the default loop driver', async () => {
    const ctx = await harness()
    const handle = await ctx.agents.create({
      sessionId: SessionId('default-composed'),
      meta: { cwd: '/tmp/default-composed' },
    })
    expect(handle.agent).not.toBeInstanceOf(ClaudeSdkAgent)
    await handle.dispose()
  })
})
