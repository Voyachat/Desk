import { describe, expect, it } from 'vitest'
import { Context } from '@voyaseek-ai/cordis'
import AgentRegistry, { agentEvents, Inbox, type Agent } from '@voyaseek-ai/dsh-agent'
import AgentMemory, {
  MemoryId, type CaptureMemoryRequest, type MemoryItem, type RecallMemoryRequest,
  type RememberMemoryRequest,
} from '@voyaseek-ai/dsh-agent-memory'
import LlmRuntime, { createAssistantMessage, createUserMessage } from '@voyaseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@voyaseek-ai/dsh-session'
import SystemPrompt from '@voyaseek-ai/dsh-system-prompt'
import ToolRuntime from '@voyaseek-ai/dsh-tools'
import * as memoryContext from '@voyaseek-ai/dsh-agent-memory-context'

class TestMemory extends AgentMemory {
  captures: CaptureMemoryRequest[] = []
  recalled: MemoryItem[] = []
  override status() {
    return { enabled: true, autoCapture: true, autoRecall: true, count: this.recalled.length, pendingCount: 0, failedCount: 0, maxEntries: 20, maxHits: 5 }
  }
  override capture(request: CaptureMemoryRequest): Promise<'queued'> { this.captures.push(request); return Promise.resolve('queued') }
  override maintain(): Promise<{ processed: number; failed: number; pending: number }> { return Promise.resolve({ processed: 0, failed: 0, pending: 0 }) }
  override remember(request: RememberMemoryRequest): Promise<MemoryItem> {
    return Promise.resolve({
      id: MemoryId(request.key), kind: request.kind, key: request.key, title: request.title,
      content: request.content, keywords: request.keywords ?? [], confidence: 1,
      createdAt: 1, updatedAt: 1, ...request.workspace === undefined ? {} : { workspace: request.workspace },
      source: { sessionId: request.sessionId, turn: request.turn, mode: 'explicit' },
    })
  }
  override recall(_request: RecallMemoryRequest): Promise<MemoryItem[]> { return Promise.resolve(this.recalled) }
  override list(): Promise<MemoryItem[]> { return Promise.resolve(this.recalled) }
  override forget(): Promise<number> { return Promise.resolve(0) }
  override clear(): Promise<number> { return Promise.resolve(0) }
}

function fakeAgent(session: ReturnType<SessionStore['create']>): Agent {
  return {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'running',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => { throw new Error('not used') },
    cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TestMemory)
  await ctx.plugin(memoryContext, { maxRecallChars: 2_000 })
  return { ctx, memory: ctx.agentMemory as TestMemory }
}

describe('agent-memory context consumer', () => {
  it('captures only a completed direct-user turn', async () => {
    const { ctx, memory } = await harness()
    const session = ctx.sessions.create(SessionId('capture'), { meta: { cwd: '/project' } })
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'my preference' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'untrusted recalled history' }],
      source: { kind: 'plugin', plugin: 'agent-memory-context', form: 'recall' },
    }), { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({ content: [{ type: 'text', text: 'noted' }], source: { provider: 'test', model: 'test' } }),
    }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await Promise.resolve()
    expect(memory.captures).toEqual([{
      sessionId: SessionId('capture'),
      turn: 1,
      workspace: '/project',
      userText: 'my preference',
      assistantText: 'noted',
    }])
    await ctx.fiber.dispose()
  })

  it('injects recalled data as a durable plugin-sourced message', async () => {
    const { ctx, memory } = await harness()
    memory.recalled = [{
      id: MemoryId('one'),
      kind: 'preference',
      key: 'verification-drink',
      title: 'drink',
      content: '用户的验证饮料是正山小种。',
      keywords: ['验证饮料'],
      confidence: 0.95,
      createdAt: 1,
      updatedAt: 1,
      workspace: '/project',
      source: { sessionId: SessionId('source'), turn: 1, mode: 'automatic' },
    }]
    const session = ctx.sessions.create(SessionId('target'), { meta: { cwd: '/project' } })
    const agent = fakeAgent(session)
    const prompt = createUserMessage({ content: [{ type: 'text', text: '我的验证饮料是什么？' }], source: { kind: 'user' } })
    const decision = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [prompt], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [prompt] }),
    )
    expect(decision.kind).toBe('enter')
    if (decision.kind === 'enter') {
      const recalled = decision.messages[0]
      expect(recalled?.source).toMatchObject({ kind: 'plugin', plugin: 'agent-memory-context', form: 'recall' })
      const recalledBlock = recalled?.content[0]
      expect(recalledBlock?.type).toBe('text')
      if (recalledBlock?.type === 'text') expect(recalledBlock.text).toContain('正山小种')
      expect(decision.messages.at(-1)?.source).toEqual({ kind: 'user' })
    }
    await ctx.fiber.dispose()
  })
})
