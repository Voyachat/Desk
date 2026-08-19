import { PassThrough } from 'node:stream'
import { Context } from '@voyaseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import LlmRuntime, { createUserMessage } from '@voyaseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@voyaseek-ai/dsh-session'
import SystemPrompt from '@voyaseek-ai/dsh-system-prompt'
import ToolRuntime from '@voyaseek-ai/dsh-tools'
import type { SubprocessHandle, SubprocessOutcome } from '@voyaseek-ai/dsh-subprocess'
import { CodexAgent } from '../src/driver.ts'
import { CodexAppServerEngine } from '../src/engine.ts'
import type {} from '../src/types.ts'

type JsonObject = Record<string, unknown>

class ProtocolPeer {
  private buffer = ''
  private readonly frames: JsonObject[] = []
  private readonly wakeups = new Set<() => void>()

  constructor(input: PassThrough, private readonly output: PassThrough) {
    input.on('data', (chunk: Buffer | string) => {
      this.buffer += chunk.toString()
      for (;;) {
        const newline = this.buffer.indexOf('\n')
        if (newline < 0) break
        const line = this.buffer.slice(0, newline)
        this.buffer = this.buffer.slice(newline + 1)
        if (line.trim().length > 0) this.frames.push(JSON.parse(line) as JsonObject)
      }
      for (const wake of this.wakeups) wake()
      this.wakeups.clear()
    })
  }

  async nextMethod(method: string): Promise<JsonObject> {
    const deadline = Date.now() + 1_000
    for (;;) {
      const index = this.frames.findIndex(frame => frame.method === method)
      if (index >= 0) return this.frames.splice(index, 1)[0]!
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new Error(`no ${method} frame; frames=${JSON.stringify(this.frames)}`)
      await Promise.race([
        new Promise<void>(resolve => { this.wakeups.add(resolve) }),
        new Promise<void>(resolve => { setTimeout(resolve, remaining) }),
      ])
    }
  }

  send(...frames: readonly JsonObject[]): void {
    this.output.write(`${frames.map(frame => JSON.stringify(frame)).join('\n')}\n`)
  }

  respond(request: JsonObject, result: unknown): void {
    this.send({ id: request.id, result })
  }
}

interface FakeChild {
  readonly handle: SubprocessHandle
  readonly peer: ProtocolPeer
  readonly terminate: ReturnType<typeof vi.fn>
  readonly waitForExit: ReturnType<typeof vi.fn>
}

function fakeChild(): FakeChild {
  const fromChild = new PassThrough()
  const toChild = new PassThrough()
  const peer = new ProtocolPeer(toChild, fromChild)
  let exited = false
  let resolveDone!: (outcome: SubprocessOutcome) => void
  const done = new Promise<SubprocessOutcome>(resolve => { resolveDone = resolve })
  const terminate = vi.fn(() => {
    if (exited) return
    exited = true
    resolveDone({ exitCode: 0, signal: null })
  })
  const waitForExit = vi.fn(async () => {
    if (!exited) await done
    return true
  })
  return {
    peer,
    terminate,
    waitForExit,
    handle: {
      pid: 1234,
      stdin: toChild,
      stdout: fromChild,
      stderr: undefined,
      collected: {},
      done,
      terminate,
      waitForExit,
    },
  }
}

async function waitIdle(driver: CodexAgent): Promise<void> {
  await Promise.race([
    driver.whenIdle(),
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => { reject(new Error(`driver did not become idle; events=${JSON.stringify(driver.session.events)}`)) }, 1_000)
    }),
  ])
}

async function nextTask(): Promise<void> {
  await new Promise<void>(resolve => { setImmediate(resolve) })
}

async function makeDriver(children: FakeChild[] = [fakeChild()]) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SystemPrompt, { persona: 'Follow the shared policy.' })
  const session = ctx.sessions.create(SessionId('codex-test'), {
    meta: { cwd: '/tmp/codex-test', agentRuntime: 'codex' },
  })
  const queue = [...children]
  const engine = new CodexAppServerEngine(() => {
    const child = queue.shift()
    if (child === undefined) throw new Error('no scripted child')
    return child.handle
  })
  const driver = new CodexAgent(
    ctx,
    session.id,
    { provider: 'dashscope', model: 'qwen-test' },
    session,
    engine,
    () => Promise.resolve({ argv: ['codex', 'app-server', '--stdio'], env: {}, disposeGraceMs: 100 }),
    '/tmp/codex-test',
    'dashscope',
    'qwen-test',
  )
  return { ctx, session, driver }
}

function prompt(driver: CodexAgent, text: string): void {
  driver.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

async function initialize(peer: ProtocolPeer): Promise<void> {
  const request = await peer.nextMethod('initialize')
  peer.respond(request, { userAgent: 'codex-cli 0.148.0' })
  await peer.nextMethod('initialized')
}

async function openFreshTurn(peer: ProtocolPeer, id = 'turn-1'): Promise<JsonObject> {
  await initialize(peer)
  const thread = await peer.nextMethod('thread/start')
  expect(thread.params).toMatchObject({ cwd: '/tmp/codex-test', ephemeral: false, model: 'qwen-test', modelProvider: 'dashscope' })
  peer.respond(thread, { thread: { id: 'thread-1', ephemeral: false, model: 'qwen-test', modelProvider: 'dashscope' } })
  const turn = await peer.nextMethod('turn/start')
  peer.respond(turn, { turn: { id, status: 'inProgress' } })
  return turn
}

describe('CodexAgent', () => {
  it('streams a balanced turn and resumes the same thread in a later process', async () => {
    const first = fakeChild()
    const second = fakeChild()
    const { session, driver } = await makeDriver([first, second])
    prompt(driver, 'first task')
    const firstTurn = await openFreshTurn(first.peer)
    expect(firstTurn.params).toMatchObject({
      threadId: 'thread-1',
      model: 'qwen-test',
      developerInstructions: expect.stringContaining('Follow the shared policy.'),
    })
    first.peer.send(
      { method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'msg-1', delta: 'hello' } },
      { method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: { id: 'msg-1', type: 'agentMessage', text: 'hello', phase: 'final_answer' } } },
      { method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', error: null } } },
    )
    await waitIdle(driver)

    expect(session.events.map(event => event.type)).toEqual(expect.arrayContaining([
      'turn/start', 'step/start', 'user/message', 'request/header', 'codex-agent/runtime',
      'assistant/chunk', 'assistant/message', 'step/end', 'turn/end',
    ]))
    expect(session.events.findLast(event => event.type === 'turn/end')?.data.reason).toEqual({ kind: 'completed' })
    expect(first.terminate).toHaveBeenCalledOnce()
    expect(first.waitForExit).toHaveBeenCalledOnce()

    prompt(driver, 'second task')
    await initialize(second.peer)
    const resume = await second.peer.nextMethod('thread/resume')
    expect(resume.params).toEqual({ threadId: 'thread-1' })
    second.peer.respond(resume, { thread: { id: 'thread-1', model: 'qwen-test', modelProvider: 'dashscope' } })
    const secondTurn = await second.peer.nextMethod('turn/start')
    second.peer.respond(secondTurn, { turn: { id: 'turn-2', status: 'inProgress' } })
    second.peer.send(
      { method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-2', item: { id: 'msg-2', type: 'agentMessage', text: 'again', phase: 'final_answer' } } },
      { method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-2', status: 'completed', error: null } } },
    )
    await waitIdle(driver)
    expect(session.events.filter(event => event.type === 'codex-agent/runtime')).toHaveLength(1)
    expect(session.events.filter(event => event.type === 'turn/end')).toHaveLength(2)
  })

  it('interrupts cancellation and reaches process-tree quiescence', async () => {
    const child = fakeChild()
    const { session, driver } = await makeDriver([child])
    prompt(driver, 'long task')
    await openFreshTurn(child.peer)
    await nextTask()
    driver.cancel({ kind: 'user' })
    await waitIdle(driver)
    expect(await child.peer.nextMethod('turn/interrupt')).toMatchObject({
      params: { threadId: 'thread-1', turnId: 'turn-1' },
    })
    expect(child.terminate).toHaveBeenCalled()
    expect(child.waitForExit).toHaveBeenCalled()
    expect(session.events.findLast(event => event.type === 'turn/end')?.data.reason)
      .toEqual({ kind: 'aborted', reason: { kind: 'user' } })
  })

  it('fails the active turn closed on an unknown server request', async () => {
    const child = fakeChild()
    const { session, driver } = await makeDriver([child])
    prompt(driver, 'unsafe task')
    await openFreshTurn(child.peer)
    child.peer.send({
      id: 'server-1',
      method: 'item/futureSideEffect/requestApproval',
      params: { threadId: 'thread-1', turnId: 'turn-1' },
    })
    await waitIdle(driver)
    expect(session.events.findLast(event => event.type === 'turn/end')?.data.reason).toMatchObject({ kind: 'error' })
    expect(child.terminate).toHaveBeenCalled()
  })

  it('rejects image input before starting an app-server process', async () => {
    const child = fakeChild()
    const { session, driver } = await makeDriver([child])
    driver.followup(createUserMessage({
      content: [{ type: 'image', attachment: { id: 'image-1', mimeType: 'image/png', width: 1, height: 1 } }],
      source: { kind: 'user' },
    }))
    await waitIdle(driver)
    expect(child.terminate).not.toHaveBeenCalled()
    expect(session.events.findLast(event => event.type === 'turn/end')?.data.reason).toMatchObject({ kind: 'error' })
  })

  it('fails before spawn when agent/request selects another provider', async () => {
    const child = fakeChild()
    const { ctx, session, driver } = await makeDriver([child])
    ctx.on('agent/request', async (_payload, _next) => ({ provider: 'google', model: 'gemini-test' }))
    prompt(driver, 'wrong route')
    await waitIdle(driver)
    expect(child.terminate).not.toHaveBeenCalled()
    expect(session.events.findLast(event => event.type === 'turn/end')?.data.reason).toMatchObject({ kind: 'error' })
  })
})
