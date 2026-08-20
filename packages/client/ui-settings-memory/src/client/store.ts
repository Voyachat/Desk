/** Long-term memory settings controller over loopback settings and memory APIs. */

import type { IApiClient, MemoryEntryView, SettingsNamespaceView } from '@voyaseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@voyaseek-ai/dsh-client-runtime/client'

/** Host Settings namespace owned by the local memory provider. */
export const AGENT_MEMORY_SETTINGS_NAMESPACE = 'agent-memory'

/** Complete page state. */
export interface MemorySettingsState {
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'unavailable' | 'error'
  error: string | null
  writable: boolean
  enabled: boolean
  maxEntries: number
  pendingCount: number
  failedCount: number
  entries: readonly MemoryEntryView[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseSettings(view: SettingsNamespaceView): { enabled: boolean } {
  if (!isRecord(view.value) || typeof view.value.enabled !== 'boolean') {
    throw new TypeError('长期记忆设置响应无效')
  }
  return { enabled: view.value.enabled }
}

/** Store compatible with the independent `settings.section` registration. */
export class MemorySettingsStore {
  /** Observable controller state consumed through `useSyncExternalStore`. */
  readonly store: SnapshotStore<MemorySettingsState> = createSnapshotStore({
    status: 'idle', error: null, writable: false, enabled: true,
    maxEntries: 0, pendingCount: 0, failedCount: 0, entries: [],
  })

  private revision: number | undefined
  private generation = 0

  constructor(private readonly api: Pick<IApiClient, 'settings' | 'memory'>) {}

  /** Load live controls and the Host-owned SQLite projection together. */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'loading'; state.error = null })
    try {
      const [settings, memory] = await Promise.all([
        this.api.settings.describe({}),
        this.api.memory.list({}),
      ])
      const settingsResult = settings.result
      const memoryResult = memory.result
      if (!settingsResult.ok) throw new Error(settingsResult.error.message)
      if (!memoryResult.ok) throw new Error(memoryResult.error.message)
      const view = settingsResult.value.namespaces.find(candidate => candidate.ns === AGENT_MEMORY_SETTINGS_NAMESPACE)
      if (generation !== this.generation) return
      if (view === undefined) {
        this.store.update((state) => { state.status = 'unavailable'; state.writable = false })
        return
      }
      const config = parseSettings(view)
      this.revision = view.revision
      this.store.update((state) => {
        state.status = 'ready'; state.error = null; state.writable = settingsResult.value.writable
        state.enabled = config.enabled; state.maxEntries = memoryResult.value.maxEntries
        state.pendingCount = memoryResult.value.pendingCount; state.failedCount = memoryResult.value.failedCount
        state.entries = memoryResult.value.entries
      })
    } catch (error) {
      if (generation === this.generation) this.fail(error)
    }
  }

  /**
   * Enable or pause automatic memory behavior without deleting stored items.
   * @param enabled - whether automatic recall and capture should run.
   */
  async setEnabled(enabled: boolean): Promise<void> {
    if (!this.store.getSnapshot().writable) return
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      const response = await this.api.settings.mutate({
        ns: AGENT_MEMORY_SETTINGS_NAMESPACE,
        ops: [{ op: 'set', path: ['enabled'], value: enabled }],
        ...(this.revision === undefined ? {} : { expectedRevision: this.revision }),
      })
      if (generation !== this.generation) return
      if (!response.result.ok) throw new Error(response.result.error.message)
      const parsed = parseSettings(response.result.value)
      this.revision = response.result.value.revision
      this.store.update((state) => { state.status = 'ready'; state.error = null; state.enabled = parsed.enabled })
    } catch (error) {
      if (generation === this.generation) this.fail(error)
    }
  }

  /**
   * Delete one selected provider-issued memory.
   * @param id - provider-issued memory identity.
   */
  async forget(id: string): Promise<void> {
    await this.memoryWrite(() => this.api.memory.forget({ ids: [id] }))
  }

  /**
   * Replace user-visible fields of one exact item and refresh every projection.
   * @param id - provider-issued memory identity.
   * @param fields - replacement title, content, and search keywords.
   * @returns whether the Host accepted the update.
   */
  async update(id: string, fields: { title: string; content: string; keywords: readonly string[] }): Promise<boolean> {
    return this.memoryWrite(() => this.api.memory.update({ id, ...fields, keywords: [...fields.keywords] }))
  }

  /** Delete all items and queued captures while retaining controls. */
  async clear(): Promise<void> {
    await this.memoryWrite(() => this.api.memory.clear({}))
  }

  /** Ask the Host to open the configuration document, never the memory database. */
  async openDocument(): Promise<void> {
    const response = await this.api.settings.openDocument({})
    if (!response.result.ok) this.fail(new Error(response.result.error.message))
  }

  /** Invalidate in-flight responses on plugin disposal. */
  dispose(): void {
    this.generation += 1
  }

  private async memoryWrite(operation: () => Promise<{ result: { ok: boolean; error?: { message: string } } }>): Promise<boolean> {
    if (!this.store.getSnapshot().writable) return false
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      const response = await operation()
      if (generation !== this.generation) return false
      if (!response.result.ok) throw new Error(response.result.error?.message ?? '长期记忆操作失败')
      await this.load()
      return true
    } catch (error) {
      if (generation === this.generation) this.fail(error)
      return false
    }
  }

  private fail(error: unknown): void {
    this.store.update((state) => {
      state.status = 'error'
      state.error = error instanceof Error ? error.message : String(error)
    })
  }
}

export type { MemoryEntryView }
