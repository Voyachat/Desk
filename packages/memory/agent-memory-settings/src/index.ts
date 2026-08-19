/**
 * Settings-configured local agent-memory provider with private SQLite storage.
 *
 * @module @voyaseek-ai/dsh-agent-memory-settings
 */

import { createHash } from 'node:crypto'
import { closeSync, mkdirSync, openSync, chmodSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Context } from '@voyaseek-ai/cordis'
import z from '@voyaseek-ai/schemastery'
import AgentMemory, {
  MemoryId,
  type AgentMemoryStatus,
  type CaptureMemoryRequest,
  type MemoryItem,
  type MemoryKind,
  type MemoryMaintainer,
  type MemoryMaintenanceResult,
  type MemoryMutation,
  type MemoryOperationOptions,
  type RecallMemoryRequest,
  type RememberMemoryRequest,
} from '@voyaseek-ai/dsh-agent-memory'
import { resolveDshHome } from '@voyaseek-ai/dsh-home-paths'
import { settingsNamespace, type SettingsScope } from '@voyaseek-ai/dsh-settings'
import { SessionId } from '@voyaseek-ai/dsh-session'

/** Settings namespace exposed to the local management page. */
export const AGENT_MEMORY_SETTINGS_NAMESPACE = 'agent-memory'
const namespace = settingsNamespace(AGENT_MEMORY_SETTINGS_NAMESPACE)
const APPLICATION_ID = 0x4453484d
const SCHEMA_VERSION = 1
const MEMORY_KINDS = ['preference', 'fact', 'constraint', 'event'] as const

/** Live local-provider configuration. */
export interface Config {
  enabled?: boolean
  autoCapture?: boolean
  autoRecall?: boolean
  maxEntries?: number
  maxHits?: number
  maxContentChars?: number
  maxTitleChars?: number
  eventTtlDays?: number
  maintenanceBatchSize?: number
  maintenanceMaxAttempts?: number
  /** Explicit database path, primarily for deployment and tests. */
  path?: string
  /** Harness home override used only when `path` is absent. */
  dshHome?: string
}

interface MemorySettings {
  enabled: boolean
  autoCapture: boolean
  autoRecall: boolean
  maxEntries: number
  maxHits: number
  maxContentChars: number
  maxTitleChars: number
  eventTtlDays: number
  maintenanceBatchSize: number
  maintenanceMaxAttempts: number
}

interface MemoryRow {
  id: string
  scope: string
  kind: MemoryKind
  semantic_key: string
  title: string
  content: string
  keywords: string
  confidence: number
  created_at: number
  updated_at: number
  expires_at: number | null
  source_session: string
  source_turn: number
  source_mode: 'automatic' | 'explicit'
}

interface OutboxRow {
  capture_key: string
  payload: string
  attempts: number
}

const positiveInteger = z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER)

/** Settings validation shared by composition defaults and user writes. */
export const MemorySettingsSchema: z<MemorySettings> = z.object({
  enabled: z.boolean().default(true),
  autoCapture: z.boolean().default(true),
  autoRecall: z.boolean().default(true),
  maxEntries: positiveInteger.default(2_000),
  maxHits: positiveInteger.default(5),
  maxContentChars: positiveInteger.default(2_000),
  maxTitleChars: positiveInteger.default(120),
  eventTtlDays: positiveInteger.default(30),
  maintenanceBatchSize: positiveInteger.default(4),
  maintenanceMaxAttempts: positiveInteger.default(5),
})

/** Cordis plugin name used by loader diagnostics. */
export const name = 'agent-memory-settings'
/** Settings provider required to own live configuration. */
export const inject = ['settings']

function abortIfRequested(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw signal.reason
}

function bounded(text: string, limit: number): string {
  const points = Array.from(text.trim())
  return points.length <= limit ? points.join('') : `${points.slice(0, Math.max(0, limit - 1)).join('')}…`
}

function normalizedKey(value: string): string {
  return bounded(value.normalize('NFKC').toLocaleLowerCase().replaceAll(/[^\p{L}\p{N}]+/gu, '-').replaceAll(/^-|-$/gu, ''), 120)
}

function scopeOf(workspace: string | undefined): string {
  return workspace ?? ''
}

function memoryIdentity(scope: string, kind: MemoryKind, key: string): MemoryId {
  const digest = createHash('sha256').update(scope).update('\0').update(kind).update('\0').update(key).digest('hex')
  return MemoryId(`memory-${digest.slice(0, 32)}`)
}

function captureIdentity(request: CaptureMemoryRequest): string {
  return `${String(request.sessionId)}:${String(request.turn)}`
}

function containsSensitive(text: string): boolean {
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/iu,
    /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/iu,
    /\b(?:password|passwd|passphrase|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret)\s*[:=]\s*\S+/iu,
    /\b(?:sk|ghp|github_pat|xox[baprs])-[_A-Za-z0-9-]{12,}\b/u,
    /\bAKIA[0-9A-Z]{16}\b/u,
  ]
  return patterns.some(pattern => pattern.test(text))
}

function terms(text: string): Set<string> {
  const normalized = text.normalize('NFKC').toLocaleLowerCase()
  const result = new Set<string>()
  for (const word of normalized.match(/[a-z0-9]+/gu) ?? []) if (word.length > 1) result.add(word)
  const nonAscii = Array.from(normalized).filter(character => /[^\x00-\x7f]/u.test(character) && /[\p{L}\p{N}]/u.test(character))
  for (let index = 0; index < nonAscii.length - 1; index += 1) result.add(`${nonAscii[index]}${nonAscii[index + 1]}`)
  return result
}

function relevance(queryTerms: ReadonlySet<string>, row: MemoryRow): number {
  const candidate = terms(`${row.semantic_key}\n${row.title}\n${row.content}\n${row.keywords}`)
  let score = 0
  for (const term of queryTerms) if (candidate.has(term)) score += 1
  return score
}

function publicItem(row: MemoryRow): MemoryItem {
  return {
    id: MemoryId(row.id),
    kind: row.kind,
    key: row.semantic_key,
    title: row.title,
    content: row.content,
    keywords: JSON.parse(row.keywords) as string[],
    confidence: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...row.expires_at === null ? {} : { expiresAt: row.expires_at },
    ...row.scope.length === 0 ? {} : { workspace: row.scope },
    source: { sessionId: SessionId(row.source_session), turn: row.source_turn, mode: row.source_mode },
  }
}

function createDatabase(path: string): DatabaseSync {
  const actual = resolve(path)
  mkdirSync(dirname(actual), { recursive: true, mode: 0o700 })
  try {
    const descriptor = openSync(actual, 'wx', 0o600)
    closeSync(descriptor)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  chmodSync(actual, 0o600)
  const db = new DatabaseSync(actual)
  try {
    const { application_id: applicationId } = db.prepare('PRAGMA application_id').get() as { application_id: number }
    const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*'").all() as Array<{ name: string }>).map(row => row.name)
    if (applicationId !== 0 && applicationId !== APPLICATION_ID) throw new Error(`agent-memory database at "${actual}" belongs to another application`)
    if (applicationId === 0 && tables.length > 0) throw new Error(`agent-memory database at "${actual}" is not empty`)
    if (applicationId === APPLICATION_ID && version !== SCHEMA_VERSION) {
      throw new Error(`agent-memory database at "${actual}" has unsupported schema version ${String(version)}`)
    }
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec(`PRAGMA application_id = ${String(APPLICATION_ID)}`)
    db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('preference','fact','constraint','event')),
        semantic_key TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        keywords TEXT NOT NULL,
        confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER,
        source_session TEXT NOT NULL,
        source_turn INTEGER NOT NULL,
        source_mode TEXT NOT NULL CHECK (source_mode IN ('automatic','explicit')),
        UNIQUE(scope, kind, semantic_key)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS memories_updated ON memories(updated_at DESC);
      CREATE INDEX IF NOT EXISTS memories_expiry ON memories(expires_at);
      CREATE TABLE IF NOT EXISTS capture_outbox (
        capture_key TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      ) STRICT;
      PRAGMA user_version = ${String(SCHEMA_VERSION)};
    `)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

/** Local structured-memory implementation configured through Settings. */
export class SettingsAgentMemory extends AgentMemory {
  static inject = ['settings']
  static Config: z<Config> = z.object({
    enabled: z.boolean(), autoCapture: z.boolean(), autoRecall: z.boolean(),
    maxEntries: positiveInteger, maxHits: positiveInteger, maxContentChars: positiveInteger,
    maxTitleChars: positiveInteger, eventTtlDays: positiveInteger,
    maintenanceBatchSize: positiveInteger, maintenanceMaxAttempts: positiveInteger,
    path: z.string(), dshHome: z.string(),
  })

  private readonly settings: SettingsScope<MemorySettings>
  private readonly db: DatabaseSync
  private tail: Promise<void> = Promise.resolve()

  constructor(host: Context, config: Config = {}) {
    super(host)
    this.settings = host.settings.register(namespace, MemorySettingsSchema, { base: config })
    const path = config.path ?? join(resolveDshHome(config.dshHome), 'memory', 'agent-memory.sqlite')
    this.db = createDatabase(path)
    this.deleteExpired(Date.now())
    host.effect(() => async () => {
      await this.tail
      this.db.close()
    }, 'agentMemorySettings.close')
  }

  override status(): AgentMemoryStatus {
    const value = this.settings.get()
    this.deleteExpired(Date.now())
    const { count } = this.db.prepare('SELECT COUNT(*) AS count FROM memories').get() as { count: number }
    const pending = this.db.prepare('SELECT COUNT(*) AS count FROM capture_outbox').get() as { count: number }
    const failed = this.db.prepare('SELECT COUNT(*) AS count FROM capture_outbox WHERE attempts >= ?').get(value.maintenanceMaxAttempts) as { count: number }
    return {
      enabled: value.enabled, autoCapture: value.autoCapture, autoRecall: value.autoRecall,
      count, pendingCount: pending.count, failedCount: failed.count,
      maxEntries: value.maxEntries, maxHits: value.maxHits,
    }
  }

  override capture(request: CaptureMemoryRequest, options?: MemoryOperationOptions): Promise<'queued' | 'duplicate' | 'disabled' | 'filtered'> {
    return this.serialized(() => {
      abortIfRequested(options?.signal)
      const config = this.settings.get()
      if (!config.enabled || !config.autoCapture) return Promise.resolve('disabled')
      const userText = bounded(request.userText, config.maxContentChars)
      const assistantText = bounded(request.assistantText, config.maxContentChars)
      if (userText.length === 0 || containsSensitive(`${userText}\n${assistantText}`)) return Promise.resolve('filtered')
      const payload: CaptureMemoryRequest = { ...request, userText, assistantText }
      const result = this.db.prepare(`
        INSERT OR IGNORE INTO capture_outbox (capture_key, payload) VALUES (?, ?)
      `).run(captureIdentity(request), JSON.stringify(payload))
      return Promise.resolve(result.changes === 0 ? 'duplicate' : 'queued')
    })
  }

  override maintain(maintainer: MemoryMaintainer, options?: MemoryOperationOptions): Promise<MemoryMaintenanceResult> {
    return this.serialized(async () => {
      const config = this.settings.get()
      if (!config.enabled || !config.autoCapture) return { processed: 0, failed: 0, pending: this.pendingCount() }
      const rows = this.db.prepare(`
        SELECT capture_key, payload, attempts FROM capture_outbox
        WHERE attempts < ? AND next_attempt_at <= ? ORDER BY rowid LIMIT ?
      `).all(config.maintenanceMaxAttempts, Date.now(), config.maintenanceBatchSize) as unknown as OutboxRow[]
      let processed = 0
      let failed = 0
      for (const row of rows) {
        abortIfRequested(options?.signal)
        const capture = JSON.parse(row.payload) as CaptureMemoryRequest
        const candidates = this.search(capture.userText, capture.workspace, undefined, config.maxHits)
        try {
          const mutations = await maintainer({ capture, candidates }, options)
          abortIfRequested(options?.signal)
          this.applyMutations(capture, candidates, mutations, config)
          this.db.prepare('DELETE FROM capture_outbox WHERE capture_key = ?').run(row.capture_key)
          processed += 1
        } catch (error) {
          const attempts = row.attempts + 1
          const delay = Math.min(60_000, 1_000 * (2 ** Math.min(attempts - 1, 6)))
          this.db.prepare('UPDATE capture_outbox SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE capture_key = ?')
            .run(attempts, Date.now() + delay, bounded(String(error), 500), row.capture_key)
          failed += 1
        }
      }
      return { processed, failed, pending: this.pendingCount() }
    })
  }

  override remember(request: RememberMemoryRequest, options?: MemoryOperationOptions): Promise<MemoryItem> {
    return this.serialized(() => {
      abortIfRequested(options?.signal)
      const config = this.settings.get()
      if (!config.enabled) throw new Error('long-term memory is disabled')
      if (containsSensitive(`${request.title}\n${request.content}\n${request.keywords?.join(' ') ?? ''}`)) {
        throw new Error('refusing to store content that appears to contain a credential or secret')
      }
      const mutation: MemoryMutation = {
        action: 'upsert', kind: request.kind, key: request.key, title: request.title,
        content: request.content, keywords: request.keywords ?? [], confidence: 1,
      }
      this.upsert(request, mutation, config, 'explicit')
      this.prune(config.maxEntries)
      const row = this.db.prepare('SELECT * FROM memories WHERE id = ?')
        .get(memoryIdentity(scopeOf(request.workspace), request.kind, normalizedKey(request.key))) as unknown as MemoryRow
      return Promise.resolve(publicItem(row))
    })
  }

  override recall(request: RecallMemoryRequest, options?: MemoryOperationOptions): Promise<MemoryItem[]> {
    return this.serialized(() => {
      abortIfRequested(options?.signal)
      const config = this.settings.get()
      if (!config.enabled || !config.autoRecall) return Promise.resolve([])
      return Promise.resolve(this.search(request.query, request.workspace, request.excludeSessionId, Math.min(request.limit ?? config.maxHits, config.maxHits)))
    })
  }

  override list(options?: MemoryOperationOptions): Promise<MemoryItem[]> {
    return this.serialized(() => {
      abortIfRequested(options?.signal)
      this.deleteExpired(Date.now())
      const rows = this.db.prepare('SELECT * FROM memories ORDER BY updated_at DESC').all() as unknown as MemoryRow[]
      return Promise.resolve(rows.map(publicItem))
    })
  }

  override forget(ids: readonly MemoryId[], options?: MemoryOperationOptions): Promise<number> {
    return this.serialized(() => {
      abortIfRequested(options?.signal)
      let deleted = 0
      for (const id of new Set(ids)) deleted += Number(this.db.prepare('DELETE FROM memories WHERE id = ?').run(id).changes)
      return Promise.resolve(deleted)
    })
  }

  override clear(options?: MemoryOperationOptions): Promise<number> {
    return this.serialized(() => {
      abortIfRequested(options?.signal)
      const count = (this.db.prepare('SELECT COUNT(*) AS count FROM memories').get() as { count: number }).count
      this.db.exec('BEGIN IMMEDIATE')
      try {
        this.db.exec('DELETE FROM memories; DELETE FROM capture_outbox; COMMIT')
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
      return Promise.resolve(count)
    })
  }

  private search(query: string, workspace: string | undefined, exclude: SessionId | undefined, limit: number): MemoryItem[] {
    this.deleteExpired(Date.now())
    const queryTerms = terms(query)
    if (queryTerms.size === 0) return []
    const rows = this.db.prepare(`
      SELECT * FROM memories
      WHERE (scope = '' OR scope = ?) AND (? IS NULL OR source_session <> ?)
      ORDER BY updated_at DESC LIMIT ?
    `).all(scopeOf(workspace), exclude ?? null, exclude ?? null, this.settings.get().maxEntries) as unknown as MemoryRow[]
    return rows.map(row => ({ row, score: relevance(queryTerms, row) }))
      .filter(item => item.score > 0)
      .sort((left, right) => right.score - left.score || right.row.confidence - left.row.confidence || right.row.updated_at - left.row.updated_at)
      .slice(0, limit)
      .map(item => publicItem(item.row))
  }

  private applyMutations(
    capture: CaptureMemoryRequest,
    candidates: readonly MemoryItem[],
    mutations: readonly MemoryMutation[],
    config: MemorySettings,
  ): void {
    const deletable = new Set(candidates.map(item => item.id))
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const mutation of mutations.slice(0, 8)) {
        switch (mutation.action) {
          case 'none': break
          case 'delete':
            if (deletable.has(mutation.id)) this.db.prepare('DELETE FROM memories WHERE id = ?').run(mutation.id)
            break
          case 'upsert':
            this.upsert(capture, mutation, config, 'automatic')
            break
        }
      }
      this.prune(config.maxEntries)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private upsert(
    source: Pick<CaptureMemoryRequest, 'sessionId' | 'turn' | 'workspace'>,
    mutation: Extract<MemoryMutation, { action: 'upsert' }>,
    config: MemorySettings,
    mode: 'automatic' | 'explicit',
  ): void {
    const key = normalizedKey(mutation.key)
    const title = bounded(mutation.title, config.maxTitleChars)
    const content = bounded(mutation.content, config.maxContentChars)
    if (key.length === 0 || title.length === 0 || content.length === 0) throw new Error('memory mutation requires non-empty key, title, and content')
    if (!MEMORY_KINDS.includes(mutation.kind) || containsSensitive(`${title}\n${content}\n${mutation.keywords.join(' ')}`)) {
      throw new Error('memory mutation contains an unsupported kind or sensitive content')
    }
    const scope = scopeOf(source.workspace)
    const id = memoryIdentity(scope, mutation.kind, key)
    const now = Date.now()
    const keywords = [...new Set(mutation.keywords.map(value => bounded(value, 80)).filter(Boolean))].slice(0, 20)
    const expiresAt = mutation.kind === 'event' ? now + config.eventTtlDays * 86_400_000 : null
    this.db.prepare(`
      INSERT INTO memories (
        id, scope, kind, semantic_key, title, content, keywords, confidence,
        created_at, updated_at, expires_at, source_session, source_turn, source_mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, kind, semantic_key) DO UPDATE SET
        title=excluded.title, content=excluded.content, keywords=excluded.keywords,
        confidence=excluded.confidence, updated_at=excluded.updated_at,
        expires_at=excluded.expires_at, source_session=excluded.source_session,
        source_turn=excluded.source_turn, source_mode=excluded.source_mode
    `).run(
      id, scope, mutation.kind, key, title, content, JSON.stringify(keywords),
      Math.max(0, Math.min(1, mutation.confidence)), now, now, expiresAt,
      source.sessionId, source.turn, mode,
    )
  }

  private prune(maxEntries: number): void {
    this.db.prepare(`
      DELETE FROM memories WHERE id IN (
        SELECT id FROM memories ORDER BY updated_at DESC LIMIT -1 OFFSET ?
      )
    `).run(maxEntries)
  }

  private deleteExpired(now: number): void {
    this.db.prepare('DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at <= ?').run(now)
  }

  private pendingCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS count FROM capture_outbox').get() as { count: number }).count
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation)
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }
}

/** Install the settings-configured local SQLite provider. */
export function apply(ctx: Context, config: Config): void {
  new SettingsAgentMemory(ctx, config)
}

export default SettingsAgentMemory
