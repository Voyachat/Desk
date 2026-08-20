import { describe, expect, it, vi } from 'vitest'
import { MemorySettingsStore } from '../src/client/store.ts'

function view(enabled = true, revision = 1) {
  return {
    ns: 'agent-memory', schema: {}, value: { enabled }, applies: 'live' as const,
    secrets: [], revision,
  }
}

const entry = {
  id: 'memory-1', kind: 'preference' as const, key: 'verification-drink', title: '验证饮料',
  content: '用户的验证饮料是正山小种。', keywords: ['验证饮料'], confidence: 0.95,
  createdAt: 1, updatedAt: 2, workspace: '/project',
  source: { sessionId: 'session-1', turn: 1, mode: 'automatic' as const },
}

function face(entries = [entry]) {
  const list = vi.fn().mockResolvedValue({
    result: { ok: true, value: { entries, pendingCount: 0, failedCount: 0, maxEntries: 2_000 } },
  })
  const forget = vi.fn().mockResolvedValue({ result: { ok: true, value: { deleted: 1 } } })
  const clear = vi.fn().mockResolvedValue({ result: { ok: true, value: { deleted: entries.length } } })
  const update = vi.fn().mockResolvedValue({ result: { ok: true, value: { entry } } })
  const describe = vi.fn().mockResolvedValue({
    result: { ok: true, value: { writable: true, hasDocument: true, namespaces: [view()] } },
  })
  const mutate = vi.fn().mockResolvedValue({ result: { ok: true, value: view(false, 2) } })
  return {
    list, forget, clear, update, describe, mutate,
    api: {
      settings: { describe, mutate, openDocument: vi.fn(), update: vi.fn(), replace: vi.fn() },
      memory: { list, forget, clear, update },
    },
  }
}

describe('MemorySettingsStore', () => {
  it('joins settings controls with Host-owned entries and deletes through memory API', async () => {
    const fixture = face()
    fixture.list.mockResolvedValueOnce({
      result: { ok: true, value: { entries: [entry], pendingCount: 1, failedCount: 0, maxEntries: 2_000 } },
    }).mockResolvedValueOnce({
      result: { ok: true, value: { entries: [], pendingCount: 0, failedCount: 0, maxEntries: 2_000 } },
    })
    const controller = new MemorySettingsStore(fixture.api)
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'ready', enabled: true, pendingCount: 1, entries: [entry] })
    await controller.forget('memory-1')
    expect(fixture.forget).toHaveBeenCalledWith({ ids: ['memory-1'] })
    expect(controller.store.getSnapshot().entries).toEqual([])
  })

  it('pauses automatic memory through Settings without clearing SQLite entries', async () => {
    const fixture = face()
    const controller = new MemorySettingsStore(fixture.api)
    await controller.load()
    await controller.setEnabled(false)
    expect(controller.store.getSnapshot()).toMatchObject({ enabled: false, entries: [entry] })
    expect(fixture.mutate).toHaveBeenCalledWith({
      ns: 'agent-memory', ops: [{ op: 'set', path: ['enabled'], value: false }], expectedRevision: 1,
    })
    expect(fixture.clear).not.toHaveBeenCalled()
  })

  it('updates an exact memory through the dedicated loopback domain', async () => {
    const fixture = face()
    const controller = new MemorySettingsStore(fixture.api)
    await controller.load()
    await expect(controller.update('memory-1', {
      title: '验证饮品', content: '用户的验证饮料是咖啡。', keywords: ['咖啡'],
    })).resolves.toBe(true)
    expect(fixture.update).toHaveBeenCalledWith({
      id: 'memory-1', title: '验证饮品', content: '用户的验证饮料是咖啡。', keywords: ['咖啡'],
    })
  })
})
