import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@voyaseek-ai/cordis'
import FileSettingsProvider from '@voyaseek-ai/dsh-settings-file'
import { MemoryId, type AgentMemory, type MemoryMaintainer } from '@voyaseek-ai/dsh-agent-memory'
import { SessionId } from '@voyaseek-ai/dsh-session'
import SettingsAgentMemory from '@voyaseek-ai/dsh-agent-memory-settings'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true })
})

async function harness(root?: string): Promise<{ ctx: Context; memory: AgentMemory; path: string; root: string }> {
  const actualRoot = root ?? await mkdtemp(join(tmpdir(), 'dsh-agent-memory-'))
  if (root === undefined) roots.push(actualRoot)
  const path = join(actualRoot, 'memory.sqlite')
  const ctx = new Context()
  await ctx.plugin(FileSettingsProvider, { path: join(actualRoot, 'settings.yaml'), watch: false })
  await ctx.plugin(SettingsAgentMemory, {
    path, maxEntries: 2, maxHits: 2, maxContentChars: 1_000, maxTitleChars: 80,
    maintenanceBatchSize: 4, maintenanceMaxAttempts: 2,
  })
  return { ctx, memory: ctx.agentMemory, path, root: actualRoot }
}

const preferenceMaintainer: MemoryMaintainer = input => Promise.resolve([{
  action: 'upsert', kind: 'preference', key: 'verification-drink', title: '验证饮料',
  content: input.capture.userText.includes('咖啡') ? '用户的验证饮料是咖啡。' : '用户的验证饮料是正山小种。',
  keywords: ['验证饮料', '喝什么'], confidence: 0.95,
}])

describe('SQLite-backed agent memory', () => {
  it('durably queues, consolidates, and corrects one semantic memory', async () => {
    const { ctx, memory, path } = await harness()
    const first = {
      sessionId: SessionId('source-session'), turn: 1, workspace: '/workspace',
      userText: '请记住我的验证饮料是正山小种', assistantText: '好的', provider: 'test', model: 'test',
    }
    await expect(memory.capture(first)).resolves.toBe('queued')
    await expect(memory.capture(first)).resolves.toBe('duplicate')
    await expect(memory.maintain(preferenceMaintainer)).resolves.toMatchObject({ processed: 1, pending: 0 })
    await memory.capture({ ...first, turn: 2, userText: '验证饮料改成咖啡' })
    await memory.maintain(preferenceMaintainer)
    const recalled = await memory.recall({ query: '我喝什么？', workspace: '/workspace' })
    expect(recalled).toHaveLength(1)
    expect(recalled[0]).toMatchObject({ kind: 'preference', key: 'verification-drink', content: '用户的验证饮料是咖啡。' })
    expect(memory.status()).toMatchObject({ count: 1, pendingCount: 0, failedCount: 0, maxEntries: 2 })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    await ctx.fiber.dispose()
  })

  it('rejects secrets before durable outbox storage and recovers pending work after restart', async () => {
    const first = await harness()
    await expect(first.memory.capture({
      sessionId: SessionId('secret'), turn: 1, userText: 'api_key = sk-example1234567890', assistantText: 'noted',
    })).resolves.toBe('filtered')
    await first.memory.capture({
      sessionId: SessionId('recover'), turn: 1, userText: '验证饮料是正山小种', assistantText: 'noted', provider: 'test', model: 'test',
    })
    expect(first.memory.status().pendingCount).toBe(1)
    await first.ctx.fiber.dispose()
    const second = await harness(first.root)
    await second.memory.maintain(preferenceMaintainer)
    expect(second.memory.status()).toMatchObject({ count: 1, pendingCount: 0 })
    await second.ctx.fiber.dispose()
  })

  it('bounds structured items and supports explicit remember, deletion, and clear', async () => {
    const { ctx, memory } = await harness()
    for (let turn = 1; turn <= 3; turn += 1) {
      await memory.remember({
        sessionId: SessionId('source'), turn, kind: 'fact', key: `fact-${String(turn)}`,
        title: `fact ${String(turn)}`, content: `value ${String(turn)}`,
      })
    }
    const listed = await memory.list()
    expect(listed).toHaveLength(2)
    await expect(memory.forget([listed[0]?.id ?? MemoryId('missing')])).resolves.toBe(1)
    await expect(memory.clear()).resolves.toBe(1)
    expect(await memory.list()).toEqual([])
    await ctx.fiber.dispose()
  })
})
