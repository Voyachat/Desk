import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@voyaseek-ai/cordis'
import FileSettingsProvider from '@voyaseek-ai/dsh-settings-file'
import { MemoryId, type AgentMemory, type MemoryMaintainer } from '@voyaseek-ai/dsh-agent-memory'
import { SessionId } from '@voyaseek-ai/dsh-session'
import SettingsAgentMemory from '@voyaseek-ai/dsh-agent-memory-settings'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true })
})

async function harness(root?: string, enabled = true): Promise<{ ctx: Context; memory: AgentMemory; path: string; root: string }> {
  const actualRoot = root ?? await mkdtemp(join(tmpdir(), 'dsh-agent-memory-'))
  if (root === undefined) roots.push(actualRoot)
  const path = join(actualRoot, 'memory.sqlite')
  const ctx = new Context()
  await ctx.plugin(FileSettingsProvider, { path: join(actualRoot, 'settings.yaml'), watch: false })
  await ctx.plugin(SettingsAgentMemory, {
    ...(enabled ? { enabled: true } : {}),
    path, maxEntries: 2, maxHits: 2, maxContentChars: 1_000, maxTitleChars: 80,
    maintenanceBatchSize: 4, maintenanceMaxAttempts: 2,
  })
  return { ctx, memory: ctx.agentMemory, path, root: actualRoot }
}

const preferenceMaintainer: MemoryMaintainer = input => Promise.resolve([{
  action: 'upsert', kind: 'preference', key: 'verification-drink', title: '验证饮料',
  content: input.capture.userText.includes('咖啡') ? '用户的验证饮料是咖啡。' : '用户的验证饮料是正山小种。',
  evidence: input.capture.userText.includes('咖啡') ? '验证饮料改成咖啡' : '验证饮料是正山小种',
  keywords: ['验证饮料', '喝什么'], confidence: 0.95,
}])

describe('SQLite-backed agent memory', () => {
  it('keeps capture and recall disabled until the user enables memory', async () => {
    const { ctx, memory } = await harness(undefined, false)
    expect(memory.status()).toMatchObject({ enabled: false, autoCapture: true, autoRecall: true })
    await expect(memory.capture({
      sessionId: SessionId('disabled'), turn: 1, userText: '请记住我的验证饮料是正山小种',
    })).resolves.toBe('disabled')
    await expect(memory.recall({ query: '验证饮料' })).resolves.toEqual([])
    await ctx.fiber.dispose()
  })

  it('rejects an older on-disk schema instead of silently upgrading it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-memory-v1-'))
    roots.push(root)
    const path = join(root, 'memory.sqlite')
    const db = new DatabaseSync(path)
    db.exec(`
      PRAGMA application_id = 1146308685;
      PRAGMA user_version = 1;
      CREATE TABLE memories (id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE capture_outbox (capture_key TEXT PRIMARY KEY) STRICT;
    `)
    db.close()

    await expect(harness(root)).rejects.toThrow('unsupported schema version 1')
  })

  it('atomically migrates schema v2 while preserving memories and pending user text', async () => {
    const first = await harness()
    await first.memory.remember({
      sessionId: SessionId('source'), turn: 1, kind: 'fact', key: 'verification-drink',
      title: '验证饮料', content: '用户的验证饮料是正山小种。',
    })
    await first.memory.capture({
      sessionId: SessionId('pending'), turn: 2, userText: '我的验证饮料改成咖啡',
    })
    await first.ctx.fiber.dispose()

    const old = new DatabaseSync(first.path)
    old.exec(`
      UPDATE capture_outbox
      SET payload = json_set(payload, '$.assistantText', '模型猜测用户还喜欢拿铁');
      PRAGMA user_version = 2;
    `)
    old.close()

    const second = await harness(first.root)
    const migrated = new DatabaseSync(first.path, { readOnly: true })
    const version = migrated.prepare('PRAGMA user_version').get() as { user_version: number }
    const payload = migrated.prepare('SELECT payload FROM capture_outbox').get() as { payload: string }
    migrated.close()
    expect(version.user_version).toBe(3)
    expect(JSON.parse(payload.payload)).toEqual({
      sessionId: 'pending', turn: 2, userText: '我的验证饮料改成咖啡',
    })
    await expect(second.memory.list()).resolves.toMatchObject([{
      key: 'verification-drink', content: '用户的验证饮料是正山小种。',
    }])
    await expect(second.memory.maintain(preferenceMaintainer)).resolves.toMatchObject({ processed: 1, failed: 0 })
    await second.ctx.fiber.dispose()
  })

  it('rolls back a failed schema migration without changing the old database', async () => {
    const first = await harness()
    await first.memory.capture({
      sessionId: SessionId('pending'), turn: 1, userText: '请记住我的验证饮料是正山小种',
    })
    await first.ctx.fiber.dispose()
    const old = new DatabaseSync(first.path)
    old.exec(`
      UPDATE capture_outbox SET payload = 'not-json';
      PRAGMA user_version = 2;
    `)
    old.close()

    await expect(harness(first.root)).rejects.toThrow('could not migrate schema version 2 to 3')
    const unchanged = new DatabaseSync(first.path, { readOnly: true })
    const version = unchanged.prepare('PRAGMA user_version').get() as { user_version: number }
    const payload = unchanged.prepare('SELECT payload FROM capture_outbox').get() as { payload: string }
    unchanged.close()
    expect(version.user_version).toBe(2)
    expect(payload.payload).toBe('not-json')
  })

  it('durably queues, consolidates, and corrects one semantic memory', async () => {
    const { ctx, memory, path } = await harness()
    const first = {
      sessionId: SessionId('source-session'), turn: 1, workspace: '/workspace',
      userText: '请记住我的验证饮料是正山小种', provider: 'test', model: 'test',
    }
    await expect(memory.capture(first)).resolves.toBe('queued')
    await expect(memory.capture(first)).resolves.toBe('duplicate')
    await expect(memory.maintain(preferenceMaintainer)).resolves.toMatchObject({
      processed: 1,
      pending: 0,
      outcomes: [{ status: 'changed', changes: [{ action: 'created', title: '验证饮料' }] }],
    })
    await expect(memory.capture(first)).resolves.toBe('duplicate')
    await memory.capture({ ...first, turn: 2, userText: '验证饮料改成咖啡' })
    await memory.maintain(preferenceMaintainer)
    const recalled = await memory.recall({ query: '我喝什么？', workspace: '/workspace' })
    expect(recalled).toHaveLength(1)
    expect(recalled[0]).toMatchObject({ kind: 'preference', key: 'verification-drink', content: '用户的验证饮料是咖啡。' })
    expect(memory.status()).toMatchObject({ count: 1, pendingCount: 0, failedCount: 0, maxEntries: 2 })
    await expect(memory.update({
      id: recalled[0]!.id, title: '验证饮品', content: '用户的验证饮料是手冲咖啡。', keywords: ['饮品'],
    })).resolves.toMatchObject({ id: recalled[0]!.id, title: '验证饮品', content: '用户的验证饮料是手冲咖啡。' })
    await expect(memory.update({
      id: recalled[0]!.id, title: '凭据', content: 'api_key = sk-example1234567890',
    })).rejects.toThrow('credential or secret')
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    await ctx.fiber.dispose()
  })

  it('rejects secrets before durable outbox storage and recovers pending work after restart', async () => {
    const first = await harness()
    await expect(first.memory.capture({
      sessionId: SessionId('secret'), turn: 1, userText: 'api_key = sk-example1234567890',
    })).resolves.toBe('filtered')
    await first.memory.capture({
      sessionId: SessionId('recover'), turn: 1, userText: '验证饮料是正山小种', provider: 'test', model: 'test',
    })
    expect(first.memory.status().pendingCount).toBe(1)
    await first.ctx.fiber.dispose()
    const second = await harness(first.root)
    await second.memory.maintain(preferenceMaintainer)
    expect(second.memory.status()).toMatchObject({ count: 1, pendingCount: 0 })
    await second.ctx.fiber.dispose()
  })

  it('does not spend a durable retry attempt when maintenance is cancelled', async () => {
    const { ctx, memory } = await harness()
    await memory.capture({
      sessionId: SessionId('cancelled'), turn: 1, userText: '验证饮料是正山小种',
    })
    const abort = new AbortController()
    await expect(memory.maintain(() => {
      abort.abort(new Error('session closed'))
      return Promise.reject(new Error('cancelled maintainer'))
    }, { signal: abort.signal })).rejects.toThrow('session closed')
    await expect(memory.maintain(preferenceMaintainer)).resolves.toMatchObject({ processed: 1, failed: 0, pending: 0 })
    await ctx.fiber.dispose()
  })

  it('rejects automatic memory without exact supporting user text', async () => {
    const { ctx, memory } = await harness()
    await memory.capture({
      sessionId: SessionId('unsupported'), turn: 1, userText: '帮我总结这份报告',
    })
    await expect(memory.maintain(() => Promise.resolve([{
      action: 'upsert', kind: 'preference', key: 'favorite-drink', title: '饮料偏好',
      content: '用户喜欢拿铁。', evidence: '我喜欢拿铁', keywords: ['拿铁'], confidence: 0.9,
    }]))).resolves.toMatchObject({ processed: 0, failed: 1, pending: 1 })
    await expect(memory.list()).resolves.toEqual([])
    await ctx.fiber.dispose()
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
