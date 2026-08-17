/**
 * claude-runtime-ui browser half on a real SlotRegistry: the plugin occupies
 * the conversation-declared `conversation.input.left` list seat with the
 * runtime chip; the injected face follows the current session runtime and
 * switches by connecting the owning workspace under the chosen runtime and
 * opening the session that lands; teardown empties the seat (HMR safety).
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { RuntimeSelector } from '../src/client/RuntimeSelector.tsx'
import type { RuntimeSelectorInjected } from '../src/client/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

const SID = 's-runtime' as SessionId

/** Minimal observable list with a mutable snapshot and subscriber fanout. */
function observableList<T>(initial: T): {
  getSnapshot: () => T
  subscribe: (fn: () => void) => () => void
  set: (next: T) => void
} {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => current,
    subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    set: (next) => { current = next; for (const fn of listeners) fn() },
  }
}

async function bench(current?: { id: SessionId; agentRuntime?: string }) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: { 'conversation.input.left': { kind: 'list', scope: 'session' } },
  } as never, () => null)

  const byId: Record<string, { id: SessionId; agentRuntime?: string }> = {}
  if (current !== undefined) byId[current.id] = current
  const sessionsList = observableList({
    ids: current === undefined ? [] : [current.id],
    byId,
    current: current?.id,
    phase: 'ready' as const,
  })
  const open = vi.fn()
  ctx.provide('sessions', { list: sessionsList, open })

  const connectWorkspace = vi.fn((_workspaceId: string, _opts?: { agentRuntime?: string }) =>
    Promise.resolve('s-next' as SessionId))
  ctx.provide('workspaces', {
    list: observableList({
      items: [{ workspaceId: 'w1', sessionIds: current === undefined ? [] : [current.id] }],
      recentWorkspaceId: 'w1',
    }),
    connectWorkspace,
  })
  ctx.provide('locale', new LocaleRuntime(ctx))
  return { ctx, slots, sessionsList, open, connectWorkspace }
}

describe('claude-runtime-ui browser apply', () => {
  it('declares every service it binds', () => {
    expect(inject).toEqual(['slots', 'locale', 'sessions', 'workspaces'])
  })

  it('node-half apply is an intentional no-op', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('waits until conversation declares the left seat', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('sessions', { list: observableList({ ids: [], byId: {}, current: undefined, phase: 'ready' }), open: vi.fn() })
    ctx.provide('workspaces', { list: observableList({ items: [], recentWorkspaceId: undefined }), connectWorkspace: vi.fn() })
    ctx.provide('locale', new LocaleRuntime(ctx))
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(ctx.slots.entries('conversation.input.left')).toHaveLength(0)
    ctx.slots.register({
      name: 'root', children: { 'conversation.input.left': { kind: 'list', scope: 'session' } },
    } as never, () => null)
    await Promise.resolve()
    expect(ctx.slots.entries('conversation.input.left')).toHaveLength(1)
  })

  it('registers the chip, follows the current runtime, and unregisters on teardown', async () => {
    const b = await bench({ id: SID, agentRuntime: 'claude' })
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.slots.entries('conversation.input.left')[0]!
    expect(entry.component).toBe(RuntimeSelector)

    // The display follows the current session at registration and on moves.
    const injected = (entry.inject as unknown as (id: SessionId) => RuntimeSelectorInjected)(SID)
    expect(injected.hooks.runtimeSelector.getSnapshot().current).toBe('claude')
    b.sessionsList.set({ ids: [SID], byId: { [SID]: { id: SID } }, current: SID, phase: 'ready' })
    expect(injected.hooks.runtimeSelector.getSnapshot().current).toBe('')

    // Switching connects the owning workspace under the pick and opens the
    // landed session (it differs from the one the pick was made under).
    injected.select('claude')
    await Promise.resolve()
    await Promise.resolve()
    expect(b.connectWorkspace).toHaveBeenCalledWith('w1', { agentRuntime: 'claude' })
    expect(b.open).toHaveBeenCalledWith('s-next')

    await fiber.dispose()
    expect(b.slots.entries('conversation.input.left')).toHaveLength(0)
  })

  it('omits the runtime option when switching to the default loop', async () => {
    const b = await bench({ id: SID, agentRuntime: 'claude' })
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.slots.entries('conversation.input.left')[0]!
    const injected = (entry.inject as unknown as (id: SessionId) => RuntimeSelectorInjected)(SID)
    injected.select('')
    await Promise.resolve()
    await Promise.resolve()
    expect(b.connectWorkspace).toHaveBeenCalledWith('w1', {})
    await fiber.dispose()
  })

  it('keeps the current session open when the switch lands on it', async () => {
    const b = await bench({ id: SID })
    b.connectWorkspace.mockResolvedValue(SID)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.slots.entries('conversation.input.left')[0]!
    const injected = (entry.inject as unknown as (id: SessionId) => RuntimeSelectorInjected)(SID)
    injected.select('claude')
    await Promise.resolve()
    await Promise.resolve()
    expect(b.open).not.toHaveBeenCalled()
    await fiber.dispose()
  })

  it('surfaces a failed switch on the chip and swallows picks in flight', async () => {
    const b = await bench({ id: SID })
    b.connectWorkspace.mockRejectedValueOnce(new Error('host unreachable'))
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.slots.entries('conversation.input.left')[0]!
    const injected = (entry.inject as unknown as (id: SessionId) => RuntimeSelectorInjected)(SID)
    injected.select('claude')
    injected.select('claude')
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    const state = injected.hooks.runtimeSelector.getSnapshot()
    expect(state.error).toBe('host unreachable')
    expect(state.busy).toBe(false)
    expect(b.connectWorkspace).toHaveBeenCalledTimes(1)
    await fiber.dispose()
  })
})
