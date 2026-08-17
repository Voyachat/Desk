/**
 * Driver-factory extension point: registered alternative drivers serve their
 * exact runtime, unregistered runtimes fail loud, and the default loop keeps
 * serving sessions that name no runtime.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { AgentCancelCause, AgentOptions, AgentStatus, InboxTarget } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import type { AgentDriver, AgentDriverFactory } from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Scope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MockAdapter } from './mock-adapter.ts'

interface Harness {
  ctx: Context
  loop: AgentLoop
  /** An injected context a custom driver closes its scope over. */
  driverCtx: Context
}

async function harness(): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], new MockAdapter([]))
  let driverCtx!: Context
  await ctx.plugin(Object.assign((inner: Context) => {
    driverCtx = inner
  }, { inject: ['sessions', 'agents'] }))
  return { ctx, loop: ctx.agentLoop, driverCtx }
}

/** Minimal driver satisfying the factory lifecycle contract. */
class StubDriver implements AgentDriver {
  readonly inbox: Inbox
  readonly scope: Scope
  readonly ctx: Context
  readonly status: AgentStatus = 'idle'
  readonly deliveries: { target: string; wakeup: boolean }[] = []
  scopeDisposalObserved = false

  constructor(
    public readonly id: SessionId,
    public readonly options: AgentOptions,
    public readonly session: Session,
    loopCtx: Context,
  ) {
    this.scope = createScope(loopCtx, this)
    this.ctx = this.scope.ctx.extend({ agent: this })
    this.ctx.effect(() => () => { this.scopeDisposalObserved = true }, 'stub.observeScopeDisposal()')
    this.inbox = new Inbox(session, {
      inserted: () => undefined,
      discarded: () => undefined,
      claimed: () => undefined,
    })
  }

  cancel(_cause: AgentCancelCause): void {}
  whenIdle(): Promise<void> {
    return Promise.resolve()
  }

  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return task(new AbortController().signal)
  }

  send(message: UserMessage, target: InboxTarget, wakeup: boolean): void {
    this.inbox.splice(target, Infinity, 0, [message])
    this.deliveries.push({ target, wakeup })
  }

  followup(message: UserMessage): void {
    this.send(message, 'next-turn', true)
  }

  steer(message: UserMessage): void {
    this.send(message, 'next-step', true)
  }

  inject(message: UserMessage): void {
    this.send(message, 'next-step', false)
  }
}

function driverFactory(ctx: Context, runtime: string, sink: StubDriver[]): AgentDriverFactory {
  return {
    runtime,
    createDriver: ({ id, options, session }) => {
      const driver = new StubDriver(id, options, session, ctx)
      sink.push(driver)
      return driver
    },
  }
}

describe('agent-loop driver factory', () => {
  it('keeps the default driver for sessions naming no runtime', async () => {
    const { ctx } = await harness()
    const handle = await ctx.agents.create({ sessionId: SessionId('default-session') })
    expect(handle.agent).not.toBeInstanceOf(StubDriver)
    expect(handle.agent.session.header.agentRuntime).toBeUndefined()
    await handle.dispose()
  })

  it('serves a registered runtime through its factory', async () => {
    const { ctx, loop, driverCtx } = await harness()
    const stubs: StubDriver[] = []
    const dispose = loop.registerDriverFactory(driverFactory(driverCtx, 'claude', stubs))
    expect(loop.driverRuntimes()).toEqual(['claude'])

    const handle = await ctx.agents.create({
      sessionId: SessionId('claude-session'),
      meta: { agentRuntime: 'claude' },
    })
    expect(stubs).toHaveLength(1)
    expect(handle.agent).toBe(stubs[0])
    expect(ctx.agents.get(SessionId('claude-session'))).toBe(stubs[0])
    expect(handle.agent.session.header.agentRuntime).toBe('claude')

    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }))
    expect(stubs[0]!.deliveries).toEqual([{ target: 'next-turn', wakeup: true }])

    await handle.dispose()
    expect(ctx.agents.get(SessionId('claude-session'))).toBeUndefined()
    expect(stubs[0]!.scopeDisposalObserved).toBe(true)
    dispose()
  })

  it('fails loud for a named runtime without a registered driver', async () => {
    const { ctx } = await harness()
    await expect(ctx.agents.create({
      sessionId: SessionId('ghost-session'),
      meta: { agentRuntime: 'ghost' },
    })).rejects.toThrow('no agent driver registered for runtime "ghost"')
  })

  it('rejects duplicate runtime registration and unwinds on dispose', async () => {
    const { ctx, loop } = await harness()
    const sink: StubDriver[] = []
    const dispose = loop.registerDriverFactory(driverFactory(ctx, 'claude', sink))
    expect(() => loop.registerDriverFactory(driverFactory(ctx, 'claude', sink)))
      .toThrow('an agent driver for runtime "claude" is already registered')
    expect(loop.driverRuntimes()).toEqual(['claude'])
    dispose()
    expect(loop.driverRuntimes()).toEqual([])
  })
})