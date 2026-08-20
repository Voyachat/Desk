/**
 * Permission default-settings controller. The permission descriptor comes
 * from the shared describe mirror; writes target the global or per-workspace
 * preset, carry the descriptor revision, and fold their answer back into the
 * mirror.
 */

import type {
  IApiClient, SettingsNamespaceView,
} from '@voyaseek-ai/dsh-api-remotes/client'
import {
  createSnapshotStore, type SnapshotStore,
} from '@voyaseek-ai/dsh-client-runtime/client'
import type {
  SchemaNode, SettingsDescribeFace, SettingsSchemaService,
} from '@voyaseek-ai/dsh-client-ui-settings/client'

/** Permission's settings namespace on the host wire. */
export const PERMISSION_SETTINGS_NS = 'permission'

/** One selectable new-session default. */
export interface PermissionDefaultOption {
  /** Preset key written to Settings. */
  id: string
  /** Host-supplied name; built-in modes are localized at render time. */
  name: string
  /** Host-supplied explanation; built-in modes are localized at render time. */
  description?: string
}

/** Permission settings-row snapshot. */
export interface PermissionSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'unavailable' | 'error'
  error: string | null
  writable: boolean
  currentValue: string
  /** Per-project defaults keyed by canonical workspace path. */
  workspaceValues: Readonly<Record<string, string>>
  options: readonly PermissionDefaultOption[]
  revision: number
}

interface ConstChoice {
  type: string
  value?: unknown
  meta?: { description?: unknown }
}

/** Settings mutation operations accepted by the wire. */
type SettingsOps = Parameters<Pick<IApiClient, 'settings'>['settings']['mutate']>[0]['ops']

/**
 * Read the dynamic preset enum encoded by the host's `defaultPreset` schema.
 * @param view - permission namespace descriptor.
 * @param schema - settings-owned schema operations.
 * @returns current global value, per-workspace values, and selectable options.
 */
export function permissionDefaultOf(view: SettingsNamespaceView, schema: SettingsSchemaService): {
  currentValue: string
  workspaceValues: Record<string, string>
  options: PermissionDefaultOption[]
} {
  const settings = view.value as { defaultPreset?: unknown; workspacePresets?: unknown } | null
  const value = settings?.defaultPreset
  if (typeof value !== 'string') throw new Error('permission settings has no defaultPreset value')
  const rawWorkspaceValues: unknown = settings?.workspacePresets ?? {}
  if (typeof rawWorkspaceValues !== 'object' || rawWorkspaceValues === null || Array.isArray(rawWorkspaceValues)) {
    throw new Error('permission settings workspacePresets is not an object')
  }
  const workspaceValues: Record<string, string> = {}
  for (const [path, preset] of Object.entries(rawWorkspaceValues)) {
    if (typeof preset !== 'string') throw new Error(`permission settings has an invalid project preset for ${path}`)
    workspaceValues[path] = preset
  }
  const node = schema.nodeAtPath(schema.rehydrate(view.schema), ['defaultPreset'])
  if (node === undefined) throw new Error('permission settings schema has no defaultPreset field')
  const rawChoices = node.type === 'union'
    ? (node.list as SchemaNode[] | undefined) ?? []
    : [node]
  const options = rawChoices.flatMap((candidate) => {
    const choice = candidate as unknown as ConstChoice
    if (choice.type !== 'const' || typeof choice.value !== 'string') return []
    const described = choice.meta?.description
    return [{
      id: choice.value,
      name: typeof described === 'string' && described.length > 0 ? described : choice.value,
    }]
  })
  if (options.length === 0 || !options.some(option => option.id === value)) {
    throw new Error('permission settings schema does not advertise its current preset')
  }
  if (Object.values(workspaceValues).some(preset => !options.some(option => option.id === preset))) {
    throw new Error('permission settings contains a project preset outside the advertised options')
  }
  return { currentValue: value, workspaceValues, options }
}

/** Controller deriving the row from the shared mirror and writing through it. */
export class PermissionPresetSettingsController {
  /** Row snapshot consumed through a bound selector hook. */
  readonly store: SnapshotStore<PermissionSettingsState> = createSnapshotStore({
    status: 'idle',
    error: null,
    writable: false,
    currentValue: '',
    workspaceValues: {},
    options: [],
    revision: 0,
  })

  private following: (() => void) | undefined
  private saving = false
  private disposed = false

  /**
   * @param describeFace - the shared mirror's read/fold face.
   * @param api - settings wire face for mutations.
   * @param schema - settings-owned schema operations.
   */
  constructor(
    private readonly describeFace: SettingsDescribeFace,
    private readonly api: Pick<IApiClient, 'settings'>,
    private readonly schema: SettingsSchemaService,
  ) {}

  /**
   * Begin following the mirror and reflect its current answer.
   * @returns settlement once the snapshot reflects the mirror.
   */
  async load(): Promise<void> {
    if (this.disposed) return
    this.following ??= this.describeFace.subscribe(() => { this.derive() })
    this.store.update((state) => {
      state.status = 'loading'
      state.error = null
    })
    await this.describeFace.ensure()
    this.derive()
  }

  /**
   * Persist one preset as the default for subsequently created sessions.
   * @param preset - advertised preset key.
   * @returns nothing; {@link store} carries success or failure.
   */
  async select(preset: string): Promise<void> {
    await this.write([{ op: 'set', path: ['defaultPreset'], value: preset }])
  }

  /**
   * Persist or clear the default for one canonical workspace path.
   * @param path - canonical project directory path.
   * @param preset - advertised preset, or undefined to inherit the global default.
   * @returns nothing; {@link store} carries success or failure.
   */
  async selectWorkspace(path: string, preset: string | undefined): Promise<void> {
    if (path.length === 0) return
    await this.write([preset === undefined
      ? { op: 'unset', path: ['workspacePresets', path] }
      : { op: 'set', path: ['workspacePresets', path], value: preset }])
  }

  /** Stop following the mirror; later publishes leave the snapshot alone. */
  dispose(): void {
    this.disposed = true
    this.following?.()
    this.following = undefined
  }

  /** Execute one revision-guarded settings mutation. */
  private async write(ops: SettingsOps): Promise<void> {
    const state = this.store.getSnapshot()
    const view = this.describeFace.getSnapshot().view?.namespaces
      .find(entry => entry.ns === PERMISSION_SETTINGS_NS)
    if (view === undefined || !state.writable || this.saving || this.disposed) return
    this.saving = true
    this.store.update((draft) => {
      draft.status = 'saving'
      draft.error = null
    })
    try {
      const response = await this.api.settings.mutate({
        ns: PERMISSION_SETTINGS_NS,
        ops,
        expectedRevision: view.revision,
      })
      this.saving = false
      if (this.disposed) return
      if (!response.result.ok) throw new Error(response.result.error.message)
      this.describeFace.acceptView(response.result.value)
    } catch (error) {
      this.saving = false
      if (this.disposed) return
      this.fail(error)
    }
  }

  private derive(): void {
    if (this.disposed || this.saving) return
    const mirrored = this.describeFace.getSnapshot()
    if (mirrored.status === 'unavailable') {
      this.unavailable()
      return
    }
    if (mirrored.view === undefined) {
      if (mirrored.error !== null) this.fail(new Error(mirrored.error))
      return
    }
    const view = mirrored.view.namespaces.find(entry => entry.ns === PERMISSION_SETTINGS_NS)
    if (view === undefined) {
      this.unavailable()
      return
    }
    try {
      const resolved = permissionDefaultOf(view, this.schema)
      this.store.update((state) => {
        state.status = 'ready'
        state.error = null
        state.writable = mirrored.view?.writable ?? false
        state.currentValue = resolved.currentValue
        state.workspaceValues = resolved.workspaceValues
        state.options = resolved.options
        state.revision = view.revision
      })
    } catch (error) {
      this.fail(error)
    }
  }

  private unavailable(): void {
    this.store.update((state) => {
      state.status = 'unavailable'
      state.error = null
      state.writable = false
      state.currentValue = ''
      state.workspaceValues = {}
      state.options = []
    })
  }

  private fail(error: unknown): void {
    this.store.update((state) => {
      state.status = 'error'
      state.error = error instanceof Error ? error.message : String(error)
    })
  }
}
