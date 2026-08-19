import { describe, expect, it, vi } from 'vitest'
import { MemorySettingsStore } from '../src/client/store.ts'

function view(entries: Record<string, unknown>, revision = 1) {
  return {
    ns: 'agent-memory',
    schema: {},
    value: {
      enabled: true,
      autoCapture: true,
      autoRecall: true,
      maxEntries: 200,
      entries,
    },
    applies: 'live',
    secrets: [],
    revision,
  }
}

const entry = {
  id: 'memory-1',
  title: '验证饮料',
  content: '用户：正山小种\n助手：已记住',
  createdAt: 1,
  updatedAt: 2,
  workspace: '/project',
  source: { sessionId: 'session-1', turn: 1 },
}

describe('MemorySettingsStore', () => {
  it('loads the exposed namespace and deletes by path with its revision', async () => {
    const describeCall = vi.fn().mockResolvedValue({
      result: { ok: true, value: { writable: true, hasDocument: true, namespaces: [view({ 'memory-1': entry })] } },
    })
    const mutate = vi.fn().mockResolvedValue({
      result: { ok: true, value: view({}, 2) },
    })
    const controller = new MemorySettingsStore({ settings: {
      describe: describeCall,
      mutate,
      openDocument: vi.fn(),
      update: vi.fn(),
      replace: vi.fn(),
    } })
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'ready', enabled: true, entries: [entry] })
    await controller.forget('memory-1')
    expect(mutate).toHaveBeenCalledWith({
      ns: 'agent-memory',
      ops: [{ op: 'unset', path: ['entries', 'memory-1'] }],
      expectedRevision: 1,
    })
    expect(controller.store.getSnapshot().entries).toEqual([])
  })

  it('pauses memory without clearing entries', async () => {
    const mutate = vi.fn().mockResolvedValue({
      result: { ok: true, value: { ...view({ 'memory-1': entry }, 2), value: { ...view({}).value, enabled: false, entries: { 'memory-1': entry } } } },
    })
    const controller = new MemorySettingsStore({ settings: {
      describe: vi.fn().mockResolvedValue({ result: { ok: true, value: { writable: true, hasDocument: true, namespaces: [view({ 'memory-1': entry })] } } }),
      mutate,
      openDocument: vi.fn(),
      update: vi.fn(),
      replace: vi.fn(),
    } })
    await controller.load()
    await controller.setEnabled(false)
    expect(controller.store.getSnapshot()).toMatchObject({ enabled: false, entries: [entry] })
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      ops: [{ op: 'set', path: ['enabled'], value: false }],
    }))
  })
})
