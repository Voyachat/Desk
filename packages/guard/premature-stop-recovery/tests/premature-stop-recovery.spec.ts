import { describe, expect, it } from 'vitest'
import { Context } from '@voyaseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@voyaseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@voyaseek-ai/dsh-agent-loop'
import type { Agent } from '@voyaseek-ai/dsh-agent'
import { createUserMessage, LlmAdapter } from '@voyaseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@voyaseek-ai/dsh-llm'
import { CallId } from '@voyaseek-ai/dsh-llm'
import { SessionId } from '@voyaseek-ai/dsh-session'
import { defineContentToolFixture } from '@voyaseek-ai/dsh-tools'
import * as Recovery from '@voyaseek-ai/dsh-premature-stop-recovery'
import { looksLikePrematureStop } from '../src/detector.ts'

function response(text: string, reason: 'stop' | 'max-tokens' = 'stop'): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: reason } },
  ]
}

function toolCall(id: string): StreamChunk[] {
  const callId = CallId(id)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: callId, name: 'work', arguments: '{}' },
    },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly responses: StreamChunk[][]) {
    super()
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const chunks = this.responses.shift()
    if (chunks === undefined) throw new Error('script exhausted')
    yield* chunks
  }
}

async function setup(script: StreamChunk[][], config: Recovery.Config = {}) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Recovery, config)
  const adapter = new ScriptedAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = ctx.agentLoop.create(SessionId('recovery'), { provider: 'mock', model: 'mock' })
  return { ctx, agent, adapter }
}

function send(agent: Agent): void {
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: 'replace the placeholder images' }],
    source: { kind: 'user' },
  }))
}

function recoveryNotices(agent: Agent): string[] {
  const notices: string[] = []
  for (const event of agent.session.events) {
    if (event.type !== 'user/message' || event.data.source.kind !== 'plugin'
      || event.data.source.plugin !== Recovery.name) continue
    const summary = (event.data.source as unknown as { summary?: unknown }).summary
    notices.push(typeof summary === 'string' ? summary : '')
  }
  return notices
}

describe('premature action-tail detector', () => {
  it.each([
    '实际上让我用一个批处理下载到临时目录先看看内容。',
    '好，发请求。',
    'Let me run the verification now.',
    "Next, I'll call the search tool.",
  ])('recognizes the reproduced unfinished tail: %s', (text) => {
    expect(looksLikePrematureStop(text)).toBe(true)
  })

  it.each([
    '图片已经下载、核对并替换完成。',
    '如果需要，我可以继续处理其他图片。',
    'Would you like me to continue?',
    'I found six valid images and two invalid URLs.',
  ])('keeps a completed result or conditional offer terminal: %s', (text) => {
    expect(looksLikePrematureStop(text)).toBe(false)
  })
})

describe('same-turn recovery', () => {
  it('continues the reproduced provider stop and logs the recovery prompt', async () => {
    const { agent, adapter } = await setup([
      response('现在下载一批候选图。实际上让我用一个批处理下载到临时目录先看看内容。'),
      response('候选图已经下载并替换完成。'),
    ])
    send(agent)
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(2)
    expect(recoveryNotices(agent)).toEqual(['Automatic continuation 1/3'])
    expect(agent.session.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(agent.session.events.filter(event => event.type === 'step/start')).toHaveLength(2)
  })

  it('does not continue a normal final answer or a max-token response', async () => {
    const normal = await setup([response('图片已经替换完成。')])
    send(normal.agent)
    await normal.agent.whenIdle()
    expect(normal.adapter.requests).toHaveLength(1)

    const capped = await setup([response('让我继续下载这些候选图片', 'max-tokens')])
    send(capped.agent)
    await capped.agent.whenIdle()
    expect(capped.adapter.requests).toHaveLength(1)
    expect(recoveryNotices(capped.agent)).toEqual([])
  })

  it('switches to an explicit incomplete report after the configured limit', async () => {
    const { agent, adapter } = await setup([
      response('让我现在运行搜索。'),
      response('好，发请求。'),
      response('任务仍未完成；最后成功下载了六张图片，还需要找到两张有效图片。'),
    ], { maxContinuations: 1 })
    send(agent)
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(3)
    expect(recoveryNotices(agent)).toEqual([
      'Automatic continuation 1/1',
      'Recovery limit reached (1)',
    ])
  })

  it('keeps recovering across a long task while tools continue to make progress', async () => {
    const { ctx, agent, adapter } = await setup([
      response('让我现在运行第一项操作。'),
      toolCall('c1'),
      response('好，继续处理下一项。'),
      toolCall('c2'),
      response('让我现在执行最终检查。'),
      response('任务已经完成并通过最终检查。'),
    ], { maxContinuations: 1 })
    ctx.tools.register(defineContentToolFixture({
      name: 'work',
      description: 'perform one concrete task action',
      parameters: {},
      execute: () => Promise.resolve([{ type: 'text', text: 'done' }]),
    }))
    send(agent)
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(6)
    expect(agent.session.events.filter(event => event.type === 'tool/result')).toHaveLength(2)
    expect(recoveryNotices(agent)).toEqual([
      'Automatic continuation 1/1',
      'Automatic continuation 1/1',
      'Automatic continuation 1/1',
    ])
  })

  it('does not treat failed tool calls as progress that resets the recovery limit', async () => {
    const { ctx, agent, adapter } = await setup([
      response('让我现在运行搜索。'),
      toolCall('failed-read'),
      response('好，发请求。'),
      response('任务仍未完成；读取工具缺少必需参数，需要提供文件路径后重试。'),
    ], { maxContinuations: 1 })
    ctx.tools.register(defineContentToolFixture({
      name: 'work',
      description: 'fail like a malformed file read',
      parameters: {},
      execute: () => Promise.reject(new Error('missing required property "file_path"')),
    }))
    send(agent)
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(4)
    expect(agent.session.events.find(event => event.type === 'tool/result')?.data)
      .toMatchObject({ message: { content: [{ isError: true }] } })
    expect(recoveryNotices(agent)).toEqual([
      'Automatic continuation 1/1',
      'Recovery limit reached (1)',
    ])
  })

  it('removes recovery behavior when its plugin fiber is disposed', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    const fiber = await ctx.plugin(Recovery, {})
    await fiber.dispose()
    const adapter = new ScriptedAdapter([response('让我运行搜索。')])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('disposed-recovery'), { provider: 'mock', model: 'mock' })
    send(agent)
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    expect(recoveryNotices(agent)).toEqual([])
  })
})
