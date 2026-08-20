/** Controller joining mobile-view settings, credential state, and live listener status. */

import type {
  CredentialView, IApiClient, SettingsNamespaceView,
} from '@voyaseek-ai/dsh-api-remotes/client'
import {
  createSnapshotStore, type SnapshotStore,
} from '@voyaseek-ai/dsh-client-runtime/client'

/** Host settings namespace for mobile remote view. */
export const MOBILE_VIEW_SETTINGS_NAMESPACE = 'mobile-view'
/** Credential reference holding the write-only remote-view bearer token. */
export const MOBILE_VIEW_TOKEN_REF = 'VOYASEEK_MOBILE_VIEW_TOKEN'
const STATUS_PATH = '/mobile-view/api/status'

/** Stable failure codes reported by the dedicated mobile-view listener. */
export type ListenerFailure = 'token-missing' | 'port-unavailable' | 'listener-failed'

/** Current dedicated listener state returned by the same-origin status endpoint. */
export interface ListenerStatus {
  requested: boolean
  listening: boolean
  port: number
  urls: readonly string[]
  error?: ListenerFailure
}

/** Complete remote-view settings page state. */
export interface MobileViewSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
  error: string | null
  writable: boolean
  enabled: boolean
  port: number
  listener: ListenerStatus
  credential: CredentialView | undefined
  /** Newly generated value shown only in this browser process. */
  visibleToken: string | null
  busy: boolean
}

type Api = Pick<IApiClient, 'settings' | 'credentials'>
type StatusReader = () => Promise<unknown>
type TokenFactory = () => string

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse the same-origin listener status without trusting arbitrary JSON.
 * @param value - untrusted JSON response value.
 * @returns validated listener state.
 */
export function parseListenerStatus(value: unknown): ListenerStatus {
  if (!isRecord(value)
    || typeof value.requested !== 'boolean'
    || typeof value.listening !== 'boolean'
    || !Number.isInteger(value.port)
    || typeof value.port !== 'number'
    || value.port < 1
    || value.port > 65_535
    || !Array.isArray(value.urls)
    || !value.urls.every(url => typeof url === 'string')) {
    throw new TypeError('远程查看状态响应无效')
  }
  const error = value.error
  if (error !== undefined
    && error !== 'token-missing'
    && error !== 'port-unavailable'
    && error !== 'listener-failed') {
    throw new TypeError('远程查看状态错误码无效')
  }
  return {
    requested: value.requested,
    listening: value.listening,
    port: value.port,
    urls: [...value.urls],
    ...(error === undefined ? {} : { error }),
  }
}

function preferences(view: SettingsNamespaceView): { enabled: boolean; port: number } {
  if (!isRecord(view.value)
    || typeof view.value.enabled !== 'boolean'
    || typeof view.value.port !== 'number'
    || !Number.isInteger(view.value.port)
    || view.value.port < 1
    || view.value.port > 65_535) {
    throw new TypeError('远程查看设置响应无效')
  }
  return { enabled: view.value.enabled, port: view.value.port }
}

/**
 * Generate a printable 256-bit token without retaining it outside the browser process.
 * @param random - cryptographic random source.
 * @returns lowercase hexadecimal token.
 */
export function generateMobileViewToken(random = globalThis.crypto): string {
  const bytes = new Uint8Array(32)
  random.getRandomValues(bytes)
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function defaultStatusReader(): Promise<unknown> {
  const response = await fetch(STATUS_PATH, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`远程查看状态请求失败（${String(response.status)}）`)
  return response.json()
}

/** Settings-page controller; every mutation refetches the Host-owned truth. */
export class MobileViewSettingsStore {
  /** Observable controller state consumed through `useSyncExternalStore`. */
  readonly store: SnapshotStore<MobileViewSettingsState> = createSnapshotStore<MobileViewSettingsState>({
    status: 'idle',
    error: null,
    writable: false,
    enabled: false,
    port: 3081,
    listener: { requested: false, listening: false, port: 3081, urls: [] },
    credential: undefined,
    visibleToken: null,
    busy: false,
  })

  private revision: number | undefined
  private generation = 0

  constructor(
    private readonly api: Api,
    private readonly readStatus: StatusReader = defaultStatusReader,
    private readonly delay: (milliseconds: number) => Promise<void> = milliseconds =>
      new Promise(resolve => setTimeout(resolve, milliseconds)),
    private readonly createToken: TokenFactory = generateMobileViewToken,
  ) {}

  /** Load preference, credential metadata, and actual listener state. */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'loading'; state.error = null })
    try {
      const [settingsResponse, credentialsResponse, statusValue] = await Promise.all([
        this.api.settings.describe({}),
        this.api.credentials.describe({ refs: [MOBILE_VIEW_TOKEN_REF] }),
        this.readStatus(),
      ])
      if (!settingsResponse.result.ok) throw new Error(settingsResponse.result.error.message)
      if (!credentialsResponse.result.ok) throw new Error(credentialsResponse.result.error.message)
      const view = settingsResponse.result.value.namespaces
        .find(candidate => candidate.ns === MOBILE_VIEW_SETTINGS_NAMESPACE)
      if (view === undefined) {
        if (generation !== this.generation) return
        this.store.update((state) => {
          state.status = 'unavailable'
          state.error = null
        })
        return
      }
      const preference = preferences(view)
      const listener = parseListenerStatus(statusValue)
      const writable = settingsResponse.result.value.writable
      const credential = credentialsResponse.result.value.credentials[MOBILE_VIEW_TOKEN_REF]
      if (generation !== this.generation) return
      this.revision = view.revision
      this.store.update((state) => {
        state.status = 'ready'
        state.error = null
        state.writable = writable
        state.enabled = preference.enabled
        state.port = preference.port
        state.listener = listener
        state.credential = credential
      })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((state) => {
        state.status = 'error'
        state.error = messageOf(error)
      })
    }
  }

  /** Enable the listener, generating a usable token when the store is writable. */
  async enable(): Promise<void> {
    await this.run(async () => {
      const snapshot = this.store.getSnapshot()
      let token: string | null = null
      if (snapshot.credential?.writable !== false) {
        token = this.createToken()
        const credential = await this.api.credentials.set({ ref: MOBILE_VIEW_TOKEN_REF, value: token })
        if (!credential.result.ok) throw new Error(credential.result.error.message)
      } else if (snapshot.credential?.configured !== true) {
        throw new Error('令牌存储不可写，且当前没有可用令牌')
      }
      await this.mutate([{ op: 'set', path: ['enabled'], value: true }])
      this.store.update((state) => { state.visibleToken = token })
      await this.waitForListener(true)
    })
  }

  /** Disable the dedicated listener without deleting its credential. */
  async disable(): Promise<void> {
    await this.run(async () => {
      await this.mutate([{ op: 'set', path: ['enabled'], value: false }])
      this.store.update((state) => { state.visibleToken = null })
      await this.waitForListener(false)
    })
  }

  /**
   * Change the requested listener port.
   * @param port - integer TCP port from 1 through 65535.
   */
  async setPort(port: number): Promise<void> {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      this.store.update((state) => { state.error = '端口必须是 1 到 65535 的整数' })
      return
    }
    await this.run(async () => {
      await this.mutate([{ op: 'set', path: ['port'], value: port }])
      await this.waitForListener(this.store.getSnapshot().enabled)
    })
  }

  /** Rotate the write-only token and show the new value for this process. */
  async regenerateToken(): Promise<void> {
    await this.run(async () => {
      const token = this.createToken()
      const response = await this.api.credentials.set({ ref: MOBILE_VIEW_TOKEN_REF, value: token })
      if (!response.result.ok) throw new Error(response.result.error.message)
      this.store.update((state) => { state.visibleToken = token })
      await this.load()
      this.store.update((state) => { state.visibleToken = token })
    })
  }

  private async run(operation: () => Promise<void>): Promise<void> {
    if (this.store.getSnapshot().busy) return
    this.store.update((state) => { state.busy = true; state.error = null })
    try {
      await operation()
    } catch (error) {
      this.store.update((state) => { state.error = messageOf(error) })
      await this.load()
      this.store.update((state) => { state.error = messageOf(error) })
    } finally {
      this.store.update((state) => { state.busy = false })
    }
  }

  private async mutate(ops: Array<{ op: 'set'; path: string[]; value: unknown }>): Promise<void> {
    const response = await this.api.settings.mutate({
      ns: MOBILE_VIEW_SETTINGS_NAMESPACE,
      ops,
      ...(this.revision === undefined ? {} : { expectedRevision: this.revision }),
    })
    if (!response.result.ok) throw new Error(response.result.error.message)
    this.revision = response.result.value.revision
    const next = preferences(response.result.value)
    this.store.update((state) => {
      state.enabled = next.enabled
      state.port = next.port
    })
  }

  private async waitForListener(listening: boolean): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = parseListenerStatus(await this.readStatus())
      this.store.update((state) => { state.listener = status })
      if (status.error !== undefined || status.listening === listening) {
        await this.load()
        return
      }
      await this.delay(100)
    }
    await this.load()
    throw new Error('远程查看监听器状态更新超时')
  }
}
