import { describe, expect, it, vi } from 'vitest'
import { Context } from '@voyaseek-ai/cordis'
import AgentRegistry, { agentEvents, Inbox, type Agent } from '@voyaseek-ai/dsh-agent'
import AgentMemory, {
  MemoryId, type CaptureMemoryRequest, type MemoryItem, type RecallMemoryRequest,
  type MemoryMaintainer, type MemoryMaintenanceResult, type RememberMemoryRequest,
  type UpdateMemoryRequest,
} from '@voyaseek-ai/dsh-agent-memory'
import LlmRuntime, { CallId, createAssistantMessage, createUserMessage } from '@voyaseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@voyaseek-ai/dsh-session'
import SystemPrompt from '@voyaseek-ai/dsh-system-prompt'
import ToolRuntime from '@voyaseek-ai/dsh-tools'
import * as memoryContext from '@voyaseek-ai/dsh-agent-memory-context'

class TestMemory extends AgentMemory {
  enabled = true
  captures: CaptureMemoryRequest[] = []
  remembered: RememberMemoryRequest[] = []
  recalled: MemoryItem[] = []
  maintenance: MemoryMaintenanceResult = { processed: 0, failed: 0, pending: 0, outcomes: [] }
  override status() {
    return {
      enabled: this.enabled,
      autoCapture: true,
      autoRecall: true,
      count: this.recalled.length,
      pendingCount: 0,
      failedCount: 0,
      maxEntries: 20,
      maxHits: 5,
    }
  }
  override capture(request: CaptureMemoryRequest): Promise<'queued'> { this.captures.push(request); return Promise.resolve('queued') }
  override maintain(_maintainer: MemoryMaintainer): Promise<MemoryMaintenanceResult> {
    return Promise.resolve(this.maintenance)
  }
  override remember(request: RememberMemoryRequest): Promise<MemoryItem> {
    this.remembered.push(request)
    return Promise.resolve({
      id: MemoryId(request.key), kind: request.kind, key: request.key, title: request.title,
      content: request.content, keywords: request.keywords ?? [], confidence: 1,
      createdAt: 1, updatedAt: 1, ...request.workspace === undefined ? {} : { workspace: request.workspace },
      source: { sessionId: request.sessionId, turn: request.turn, mode: 'explicit' },
    })
  }
  override update(request: UpdateMemoryRequest): Promise<MemoryItem> {
    const index = this.recalled.findIndex(item => item.id === request.id)
    const current = this.recalled[index]
    if (current === undefined) return Promise.reject(new Error(`missing memory ${request.id}`))
    const updated = {
      ...current,
      title: request.title,
      content: request.content,
      keywords: request.keywords ?? current.keywords,
    }
    this.recalled[index] = updated
    return Promise.resolve(updated)
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
  it('keeps capture, prompt guidance, and model-visible memory tools off while disabled', async () => {
    const { ctx, memory } = await harness()
    memory.enabled = false
    const session = ctx.sessions.create(SessionId('disabled'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '请记住我的验证饮料是正山小种' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await Promise.resolve()
    expect(memory.captures).toEqual([])
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.find(section => section.name === 'tool:agent-memory')?.text).toBe('')
    expect(assembly.tools.map(tool => tool.name)).not.toEqual(expect.arrayContaining([
      'memory_search', 'memory_remember', 'memory_forget',
    ]))
    memory.recalled = [{
      id: MemoryId('disabled-memory'), kind: 'fact', key: 'disabled', title: 'disabled',
      content: '不应召回', keywords: ['不应'], confidence: 1, createdAt: 1, updatedAt: 1,
      source: { sessionId: SessionId('source'), turn: 1, mode: 'automatic' },
    }]
    const agent = fakeAgent(session)
    const prompt = createUserMessage({ content: [{ type: 'text', text: '查询' }], source: { kind: 'user' } })
    const decision = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [prompt], turn: 2, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [prompt] }),
    )
    expect(decision).toMatchObject({ kind: 'enter', messages: [prompt] })
    await ctx.fiber.dispose()
  })

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
    }])
    await ctx.fiber.dispose()
  })

  it('injects recalled data as a durable memory-sourced message', async () => {
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
      expect(recalled?.source).toEqual({
        kind: 'agent-memory',
        form: 'recall',
        items: [{ id: MemoryId('one'), kind: 'preference', title: 'drink' }],
      })
      const recalledBlock = recalled?.content[0]
      expect(recalledBlock?.type).toBe('text')
      if (recalledBlock?.type === 'text') expect(recalledBlock.text).toContain('正山小种')
      expect(decision.messages.at(-1)?.source).toEqual({ kind: 'user' })
    }
    await ctx.fiber.dispose()
  })

  it('requires memory_remember to cite the current direct user message', async () => {
    const { ctx, memory } = await harness()
    const session = ctx.sessions.create(SessionId('explicit'), { meta: { cwd: '/project' } })
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '请记住：我的验证饮料是正山小种。' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const agent = fakeAgent(session)
    const execute = (callId: string, evidence: string) => ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId(callId),
      name: 'memory_remember',
      arguments: {
        kind: 'preference', key: 'verification-drink', title: '验证饮料',
        content: '用户的验证饮料是正山小种。', evidence,
      },
      agent,
    })

    const rejected = await execute('unsupported', '模型认为用户喜欢正山小种')
    expect(rejected).toMatchObject({ isError: true })
    expect(memory.remembered).toEqual([])
    const accepted = await execute('supported', '我的验证饮料是正山小种')
    expect(accepted).toMatchObject({ isError: false })
    expect(memory.remembered).toMatchObject([{
      sessionId: SessionId('explicit'), turn: 1, workspace: '/project',
      kind: 'preference', key: 'verification-drink', content: '用户的验证饮料是正山小种。',
    }])
    await ctx.fiber.dispose()
  })

  it('logs the provider commit outcome in its originating session', async () => {
    const { ctx, memory } = await harness()
    memory.maintenance = {
      processed: 1,
      failed: 0,
      pending: 0,
      outcomes: [{ sessionId: SessionId('maintained'), turn: 1, status: 'changed', changes: [] }],
    }
    const session = ctx.sessions.create(SessionId('maintained'), { meta: { cwd: '/project' } })
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '记住这个事实' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await vi.waitFor(() => {
      expect(session.events.at(-1)).toMatchObject({
        type: 'agent-memory/maintenance',
        data: { turn: 1, status: 'changed', changes: [] },
      })
    })
    await ctx.fiber.dispose()
  })
})
