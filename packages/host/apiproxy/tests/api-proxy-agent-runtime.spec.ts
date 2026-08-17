/**
 * A session's agent runtime is fixed at creation. The gateway validates the
 * requested runtime against the driver registry, records it on the header,
 * echoes it in the create response, and serves it in list summaries. A cold
 * resume under a different runtime is refused because the stored history was
 * produced under the recorded driver.
 */

import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type AgentFactory } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId, type Session, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { RpcId, type RpcRequest } from '../src/api/rpc.ts'
import { createApiProxy } from '../src/api-proxy.ts'

let nextRpc = 0
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`runtime-${String(nextRpc++)}`), payload }
}

const sid = (id: string): SessionId => id as SessionId

/** Minimal live agent; the gateway only needs identity and its session. */
function stubAgent(session: Session): Agent {
  return { id: session.id, session, status: 'idle' } as unknown as Agent
}

function header(id: string, createdAt: number, extra: Partial<SessionHeader> = {}): SessionHeader {
  return { version: 0, id: sid(id), createdAt, cwd: '/proj', ...extra }
}

/**
 * Harness with a stub agent factory and an optional driver-runtime roster.
 * `runtimes` doubles the AgentLoop's `driverRuntimes()`; omitted means no
 * driver is registered, so any requested runtime fails `runtime-not-found`.
 * Create requests omit `cwd` so the harness temp directory (which exists) is
 * the session project; cold-resume requests name `/proj` to match the stored
 * header, and that path never creates the directory.
 */
async function harness(options: {
  runtimes?: readonly string[]
  persistence?: {
    list: () => Promise<SessionHeader[]>
    inspect: (id: SessionId) => Promise<{ meta: SessionHeader; events: SessionEvent[] }>
  }
} = {}) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-runtime-')))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  ctx.provide('sessionPersistence', options.persistence === undefined
    ? { list: () => Promise.resolve([]) } as never
    : { list: options.persistence.list, inspect: options.persistence.inspect, locate: () => undefined } as never)
  if (options.runtimes !== undefined) {
    const roster = [...options.runtimes]
    ctx.provide('agentLoop', { driverRuntimes: () => roster } as never)
  }
  const factory: AgentFactory = {
    async createAgent(_ownerCtx, opts) {
      const session = ctx.sessions.create(
        opts.sessionId,
        opts.meta === undefined ? {} : { meta: opts.meta },
      )
      const agent = stubAgent(session)
      const agentCtx = ctx.extend({ agent })
      ;(agent as { ctx?: Context }).ctx = agentCtx
      await opts.setup?.(agentCtx)
      const unregister = ctx.agents.register(agent)
      return { agent, dispose: () => { unregister(); return Promise.resolve() } }
    },
    async resume(_ownerCtx, opts) {
      const session = ctx.sessions.create(opts.resumeSessionId, { meta: { cwd: '/proj', agentRuntime: 'claude' } })
      const agent = stubAgent(session)
      const unregister = ctx.agents.register(agent)
      return { agent, dispose: () => { unregister(); return Promise.resolve() } }
    },
  }
  ctx.agents.setFactory(factory)
  return {
    ctx,
    api: createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
      cwd,
    }),
  }
}

describe('session.create agentRuntime', () => {
  it('records the runtime on the header and echoes it in the response', async () => {
    const { ctx, api } = await harness({ runtimes: ['claude'] })
    const created = await api.sessions.create(request({ agentRuntime: 'claude' }))
    if (!created.result.ok) throw new Error(String(created.result.error))
    expect(created.result.value.agentRuntime).toBe('claude')
    const session = ctx.sessions.get(created.result.value.sessionId)
    expect(session?.header.agentRuntime).toBe('claude')
    await ctx.fiber.dispose()
  })

  it('serves the runtime in list summaries', async () => {
    const { ctx, api } = await harness({ runtimes: ['claude'] })
    const created = await api.sessions.create(request({ agentRuntime: 'claude' }))
    if (!created.result.ok) throw new Error(String(created.result.error))
    const createdId = created.result.value.sessionId
    const listed = await api.sessions.list(request({}))
    if (!listed.result.ok) throw new Error(String(listed.result.error))
    const row = listed.result.value.items.find(item => item.sessionId === createdId)
    expect(row?.agentRuntime).toBe('claude')
    await ctx.fiber.dispose()
  })

  it('omits the runtime field when no runtime is requested', async () => {
    const { ctx, api } = await harness({ runtimes: ['claude'] })
    const created = await api.sessions.create(request({}))
    if (!created.result.ok) throw new Error(String(created.result.error))
    expect(created.result.value.agentRuntime).toBeUndefined()
    const session = ctx.sessions.get(created.result.value.sessionId)
    expect(session?.header.agentRuntime).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('rejects an unregistered runtime with the available roster', async () => {
    const { ctx, api } = await harness({ runtimes: ['claude'] })
    const created = await api.sessions.create(request({ agentRuntime: 'bogus' }))
    expect(created.result.ok).toBe(false)
    if (!created.result.ok) {
      expect(created.result.error.code).toBe('runtime-not-found')
      expect(created.result.error.details).toMatchObject({ agentRuntime: 'bogus', available: ['claude'] })
    }
    await ctx.fiber.dispose()
  })

  it('rejects any runtime when no driver is registered', async () => {
    const { ctx, api } = await harness()
    const created = await api.sessions.create(request({ agentRuntime: 'claude' }))
    expect(created.result.ok).toBe(false)
    if (!created.result.ok) {
      expect(created.result.error.code).toBe('runtime-not-found')
    }
    await ctx.fiber.dispose()
  })
})

describe('cold resume runtime fence', () => {
  it('refuses to resume a stored session under a different runtime', async () => {
    const sessionId = sid('runtime-cold')
    const meta = header('runtime-cold', 1000, { agentRuntime: 'claude' })
    const { ctx, api } = await harness({ runtimes: ['claude', 'openai'], persistence: {
      list: () => Promise.resolve([meta]),
      inspect: () => Promise.resolve({ meta, events: [] as SessionEvent[] }),
    } })
    const resumed = await api.sessions.create(request({ sessionId, cwd: '/proj', agentRuntime: 'openai' }))
    expect(resumed.result.ok).toBe(false)
    if (!resumed.result.ok) {
      expect(resumed.result.error.code).toBe('runtime-conflict')
      expect(resumed.result.error.details).toMatchObject({ requestedRuntime: 'openai', existingRuntime: 'claude' })
    }
    await ctx.fiber.dispose()
  })

  it('resumes a stored session under its recorded runtime', async () => {
    const sessionId = sid('runtime-cold-match')
    const meta = header('runtime-cold-match', 1000, { agentRuntime: 'claude' })
    const { ctx, api } = await harness({ runtimes: ['claude'], persistence: {
      list: () => Promise.resolve([meta]),
      inspect: () => Promise.resolve({ meta, events: [] as SessionEvent[] }),
    } })
    const resumed = await api.sessions.create(request({ sessionId, cwd: '/proj', agentRuntime: 'claude' }))
    if (!resumed.result.ok) throw new Error(String(resumed.result.error))
    expect(resumed.result.value.sessionId).toBe('runtime-cold-match')
    expect(resumed.result.value.agentRuntime).toBe('claude')
    await ctx.fiber.dispose()
  })
})
