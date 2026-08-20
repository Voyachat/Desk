import { Context } from '@voyaseek-ai/cordis'
import type { ConnectionHandle, RpcId } from '@voyaseek-ai/dsh-api-remotes/client'
import type {
  ClientContext, ISessions, SessionId, SessionListState,
} from '@voyaseek-ai/dsh-client-runtime/client'
import { describe, expect, it, vi } from 'vitest'
import {
  installDesktopStartupHandoff, type DesktopStartupBridge,
} from '../src/startup-intent.ts'

const SESSION_ID = 'startup-session' as SessionId
const RPC_ID = 'startup-select' as RpcId

function listState(current: SessionId | undefined, blank = false): SessionListState {
  return {
    ids: current === undefined ? [] : [current],
    byId: current === undefined
      ? {}
      : {
        [current]: {
          id: current,
          displayTitle: current,
          running: false,
          blank,
          updatedAt: 1,
        },
      },
    current,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

function sessionList(initial: SessionListState) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    source: {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    publish(next: SessionListState) {
      snapshot = next
      for (const listener of [...listeners]) listener()
    },
  }
}

interface HarnessOptions {
  readonly initial?: SessionListState
  readonly select?: ConnectionHandle['api']['agentPresets']['select']
  readonly setDraft?: (text: string) => void
}

async function harness(options: HarnessOptions = {}) {
  const ctx = new Context()
  const list = sessionList(options.initial ?? listState(SESSION_ID, true))
  const order: string[] = []
  const setDraft = vi.fn(options.setDraft ?? ((text: string) => { order.push(`draft:${text}`) }))
  const conversation = {
    input: {
      for: vi.fn((scope: ClientContext) => {
        expect(scope).toBe(ctx)
        return { setDraft }
      }),
    },
  }
  const noteAgentPreset = vi.fn((_sessionId: SessionId, preset: string) => {
    order.push(`note:${preset}`)
  })
  const sessions = {
    list: list.source,
    scope: vi.fn(() => ctx),
    noteAgentPreset,
  } as unknown as ISessions
  const select = vi.fn(options.select ?? (async (payload: { agentPreset: string }) => {
    order.push(`select:${payload.agentPreset}`)
    return {
      rpcId: RPC_ID,
      result: { ok: true as const, value: { agentPreset: payload.agentPreset } },
    }
  }))
  const connection = {
    api: { agentPresets: { select } },
  } as unknown as ConnectionHandle
  const acknowledge = vi.fn(async () => { order.push('ack') })
  const getIntent = vi.fn(async () => ({ draft: '先写需求', agentPreset: 'code' as const }))
  const bridge: DesktopStartupBridge = { getIntent, acknowledge }

  ctx.provide('sessions', sessions)
  ctx.provide('conversation', conversation)
  ctx.provide('connection', connection)
  const fiber = ctx.plugin({
    apply(scope: ClientContext) {
      installDesktopStartupHandoff(scope, bridge)
    },
  })
  await fiber.await()

  return {
    acknowledge,
    bridge,
    conversation,
    fiber,
    getIntent,
    list,
    noteAgentPreset,
    order,
    select,
    sessions,
    setDraft,
  }
}

describe('Desktop startup intent handoff', () => {
  it('applies preset, records it, writes the draft, then acknowledges exactly once', async () => {
    const b = await harness()

    await vi.waitFor(() => { expect(b.acknowledge).toHaveBeenCalledOnce() })

    expect(b.order).toEqual(['select:code', 'note:code', 'draft:先写需求', 'ack'])
    expect(b.getIntent).toHaveBeenCalledOnce()
    expect(b.select).toHaveBeenCalledWith({ sessionId: SESSION_ID, agentPreset: 'code' })
    expect(b.noteAgentPreset).toHaveBeenCalledWith(SESSION_ID, 'code')
    expect(b.setDraft).toHaveBeenCalledWith('先写需求')

    b.list.publish(listState(SESSION_ID, true))
    await Promise.resolve()
    expect(b.select).toHaveBeenCalledOnce()
    await b.fiber.dispose()
  })

  it('waits through no-current and non-blank states for a real current blank Session', async () => {
    const b = await harness({ initial: listState(undefined) })
    await vi.waitFor(() => { expect(b.getIntent).toHaveBeenCalledOnce() })
    expect(b.select).not.toHaveBeenCalled()

    b.list.publish(listState(SESSION_ID, false))
    await Promise.resolve()
    expect(b.select).not.toHaveBeenCalled()

    b.list.publish(listState(SESSION_ID, true))
    await vi.waitFor(() => { expect(b.acknowledge).toHaveBeenCalledOnce() })
    expect(b.order).toEqual(['select:code', 'note:code', 'draft:先写需求', 'ack'])
    await b.fiber.dispose()
  })

  it('leaves the intent unacknowledged when preset selection fails', async () => {
    const b = await harness({
      select: async () => ({
        rpcId: RPC_ID,
        result: {
          ok: false as const,
          error: {
            code: 'agent-preset-locked',
            message: 'session started',
            details: { sessionId: SESSION_ID, agentPreset: 'code' },
          },
        },
      }),
    })

    await vi.waitFor(() => { expect(b.select).toHaveBeenCalledOnce() })
    expect(b.noteAgentPreset).not.toHaveBeenCalled()
    expect(b.setDraft).not.toHaveBeenCalled()
    expect(b.acknowledge).not.toHaveBeenCalled()

    b.list.publish(listState(SESSION_ID, true))
    await Promise.resolve()
    expect(b.select).toHaveBeenCalledOnce()
    await b.fiber.dispose()
  })

  it('leaves the intent unacknowledged when the scoped draft write fails', async () => {
    const b = await harness({ setDraft: () => { throw new Error('input unavailable') } })

    await vi.waitFor(() => { expect(b.noteAgentPreset).toHaveBeenCalledOnce() })
    expect(b.setDraft).toHaveBeenCalledOnce()
    expect(b.acknowledge).not.toHaveBeenCalled()
    await b.fiber.dispose()
  })
})
