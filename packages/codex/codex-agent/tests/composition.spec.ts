import { Context } from '@voyaseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import AgentRegistry from '@voyaseek-ai/dsh-agent'
import AgentLoop from '@voyaseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage } from '@voyaseek-ai/dsh-llm'
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

    const assembledModels: string[] = []
    ctx.systemPrompt.section({
      name: 'codex-composition-tools',
      order: 0,
      text: ({ agent }) => {
        if (agent !== undefined && agent.ctx.tools !== undefined && agent.options.model !== undefined) {
          assembledModels.push(agent.options.model)
        }
        return ''
      },
    })
    ctx.on('agent/pre-step', async () => ({ kind: 'reject' as const }))

    for (const model of ['qwen-test', 'deepseek-test']) {
      const sessionId = SessionId(`codex-composed-${model}`)
      const handle = await ctx.agents.create({
        sessionId,
        meta: { cwd: `/tmp/${sessionId}`, agentRuntime: 'codex' },
        agentOptions: { provider: 'dashscope', model },
      })
      expect(handle.agent).toBeInstanceOf(CodexAgent)
      expect(handle.agent.modelConstraint).toEqual({
        provider: 'dashscope',
        defaultModel: 'qwen-test',
        models: ['qwen-test', 'deepseek-test'],
        routes: [{ provider: 'dashscope', models: ['qwen-test', 'deepseek-test'] }],
      })
      expect(handle.agent.status).toBe('idle')

      handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text: 'exercise prompt assembly' }],
        source: { kind: 'user' },
      }))
      await handle.agent.whenIdle()
      expect(handle.agent.session.events.findLast(event => event.type === 'turn/end')?.data.reason)
        .toEqual({ kind: 'blocked' })

      await handle.dispose()
      expect(ctx.agents.get(sessionId)).toBeUndefined()
    }

    expect(assembledModels).toEqual(['qwen-test', 'deepseek-test'])
  })
})
