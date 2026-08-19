/** Long-term memory settings controller over the existing loopback settings API. */

import type { IApiClient, SettingsNamespaceView } from '@voyaseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@voyaseek-ai/dsh-client-runtime/client'

/** Host Settings namespace owned by the local memory provider. */
export const AGENT_MEMORY_SETTINGS_NAMESPACE = 'agent-memory'

/** One browser-safe memory item projected from the Host-owned namespace. */
export interface MemoryEntryView {
  id: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
  workspace?: string
  source: { sessionId: string; turn: number }
}

/** Complete page state. */
export interface MemorySettingsState {
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'unavailable' | 'error'
  error: string | null
  writable: boolean
  enabled: boolean
  maxEntries: number
  entries: readonly MemoryEntryView[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseEntry(value: unknown): MemoryEntryView {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.title !== 'string'
    || typeof value.content !== 'string'
    || typeof value.createdAt !== 'number'
    || typeof value.updatedAt !== 'number'
    || !isRecord(value.source)
    || typeof value.source.sessionId !== 'string'
    || typeof value.source.turn !== 'number'
    || (value.workspace !== undefined && typeof value.workspace !== 'string')) {
    throw new TypeError('长期记忆设置响应包含无效条目')
  }
  return {
    id: value.id,
    title: value.title,
    content: value.content,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...value.workspace === undefined ? {} : { workspace: value.workspace },
    source: { sessionId: value.source.sessionId, turn: value.source.turn },
  }
}

function parseView(view: SettingsNamespaceView): Omit<MemorySettingsState, 'status' | 'error' | 'writable'> {
  const value = view.value
  if (!isRecord(value)
    || typeof value.enabled !== 'boolean'
    || typeof value.maxEntries !== 'number'
    || !isRecord(value.entries)) {
    throw new TypeError('长期记忆设置响应无效')
  }
  return {
    enabled: value.enabled,
    maxEntries: value.maxEntries,
    entries: Object.values(value.entries).map(parseEntry).sort((left, right) => right.updatedAt - left.updatedAt),
  }
}

/** Revision-guarded store used by the independently registered settings page. */
export class MemorySettingsStore {
  /** Observable controller state consumed through `useSyncExternalStore`. */
  readonly store: SnapshotStore<MemorySettingsState> = createSnapshotStore({
    status: 'idle',
    error: null,
    writable: false,
    enabled: true,
    maxEntries: 0,
    entries: [],
  })

  private revision: number | undefined
  private generation = 0

  constructor(private readonly api: Pick<IApiClient, 'settings'>) {}

  /** Load the exposed memory namespace. */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'loading'; state.error = null })
    try {
      const response = await this.api.settings.describe({})
      if (!response.result.ok) throw new Error(response.result.error.message)
      const view = response.result.value.namespaces.find(candidate => candidate.ns === AGENT_MEMORY_SETTINGS_NAMESPACE)
      if (generation !== this.generation) return
      if (view === undefined) {
        this.store.update((state) => { state.status = 'unavailable'; state.writable = false })
        return
      }
      this.accept(view, response.result.value.writable)
    } catch (error) {
      if (generation !== this.generation) return
      this.fail(error)
    }
  }

  /**
   * Enable or pause automatic memory behavior without deleting stored items.
   * @param enabled - next automatic-memory state.
   */
  setEnabled(enabled: boolean): Promise<void> {
    return this.write([{ op: 'set', path: ['enabled'], value: enabled }])
  }

  /**
   * Delete one selected memory.
   * @param id - memory identity received from the Host.
   */
  forget(id: string): Promise<void> {
    return this.write([{ op: 'unset', path: ['entries', id] }])
  }

  /** Delete all items while retaining the user's control settings. */
  clear(): Promise<void> {
    return this.write([{ op: 'set', path: ['entries'], value: {} }])
  }

  /** Ask the Host to open the local settings document containing the bounded store. */
  async openDocument(): Promise<void> {
    const response = await this.api.settings.openDocument({})
    if (!response.result.ok) this.fail(new Error(response.result.error.message))
  }

  /** Invalidate in-flight responses on plugin disposal. */
  dispose(): void {
    this.generation += 1
  }

  private async write(ops: Parameters<Pick<IApiClient, 'settings'>['settings']['mutate']>[0]['ops']): Promise<void> {
    if (!this.store.getSnapshot().writable) return
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      const response = await this.api.settings.mutate({
        ns: AGENT_MEMORY_SETTINGS_NAMESPACE,
        ops,
        ...(this.revision === undefined ? {} : { expectedRevision: this.revision }),
      })
      if (generation !== this.generation) return
      if (!response.result.ok) throw new Error(response.result.error.message)
      this.accept(response.result.value, true)
    } catch (error) {
      if (generation !== this.generation) return
      this.fail(error)
    }
  }

  private accept(view: SettingsNamespaceView, writable: boolean): void {
    const parsed = parseView(view)
    this.revision = view.revision
    this.store.update((state) => {
      state.status = 'ready'
      state.error = null
      state.writable = writable
      state.enabled = parsed.enabled
      state.maxEntries = parsed.maxEntries
      state.entries = parsed.entries
    })
  }

  private fail(error: unknown): void {
    this.store.update((state) => {
      state.status = 'error'
      state.error = error instanceof Error ? error.message : String(error)
    })
  }
}
