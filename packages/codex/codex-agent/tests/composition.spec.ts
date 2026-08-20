import { Context } from '@voyaseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import AgentRegistry from '@voyaseek-ai/dsh-agent'
import AgentLoop from '@voyaseek-ai/dsh-agent-loop'
import LlmRuntime from '@voyaseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@voyaseek-ai/dsh-session'
import LocalSubprocessRuntime from '@voyaseek-ai/dsh-subprocess-local'
import SystemPrompt from '@voyaseek-ai/dsh-system-prompt'
import ToolRuntime from '@voyaseek-ai/dsh-tools'
import * as codexAgent from '../src/index.ts'
import { CodexAgent } from '../src/driver.ts'

describe('codex-agent composition', () => {
  it('registers and serves the codex runtime without spawning during creation', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(codexAgent, { provider: 'dashscope', model: 'qwen-test', models: ['qwen-test', 'deepseek-test'] })
    expect(ctx.agentLoop.driverRuntimes()).toEqual(['codex'])

    const handle = await ctx.agents.create({
      sessionId: SessionId('codex-composed'),
      meta: { cwd: '/tmp/codex-composed', agentRuntime: 'codex' },
    })
    expect(handle.agent).toBeInstanceOf(CodexAgent)
    expect(handle.agent.modelConstraint).toEqual({
      provider: 'dashscope',
      defaultModel: 'qwen-test',
      models: ['qwen-test', 'deepseek-test'],
      routes: [{ provider: 'dashscope', models: ['qwen-test', 'deepseek-test'] }],
    })
    expect(handle.agent.status).toBe('idle')
    await handle.dispose()
    expect(ctx.agents.get(SessionId('codex-composed'))).toBeUndefined()
  })
})
