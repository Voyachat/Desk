import { defineStore, type EngineStoreHandle } from '@voyaseek-ai/dsh-client-runtime/client'

type EmployeeRef = ReturnType<typeof import('@voyaseek-ai/dsh-aistaff-employee-experience').EmployeeRef>
type EngagementRef = ReturnType<typeof import('@voyaseek-ai/dsh-aistaff-employee-experience').EngagementRef>

/** Renderer-only state for the production Cloud workbench. */
export interface CloudProductState {
  /** Whether the additive overlay is visible. */
  open: boolean
  /** Employee selected in the current view. */
  selectedEmployeeRef: EmployeeRef | null
  /** Collaboration selected in the current view. */
  selectedEngagementRef: EngagementRef | null
  /** Current message draft. */
  draft: string
  /** Whether one user operation is in flight. */
  busy: boolean
  /** Display-safe operation feedback. */
  error: string | null
}

/** Mutations limited to transient Renderer state. */
export type CloudProductActions = {
  openWorkbench: (draft: CloudProductState) => void
  closeWorkbench: (draft: CloudProductState) => void
  selectEmployee: (draft: CloudProductState, employeeRef: EmployeeRef) => void
  selectEngagement: (draft: CloudProductState, engagementRef: EngagementRef | null) => void
  setDraft: (draft: CloudProductState, value: string) => void
  setBusy: (draft: CloudProductState, busy: boolean) => void
  setError: (draft: CloudProductState, error: string | null) => void
}

/**
 * Create the production Cloud workbench store. Business projection remains in
 * `EmployeeExperiencePort` and never appears in this store.
 * @returns a fresh root-scoped transient store handle.
 */
export function createCloudProductStore(): EngineStoreHandle<CloudProductState, CloudProductActions> {
  return defineStore({
    init: (): CloudProductState => ({
      open: false,
      selectedEmployeeRef: null,
      selectedEngagementRef: null,
      draft: '',
      busy: false,
      error: null,
    }),
    actions: {
      openWorkbench: draft => { draft.open = true },
      closeWorkbench: draft => { draft.open = false },
      selectEmployee: (draft, employeeRef) => {
        draft.selectedEmployeeRef = employeeRef
        draft.selectedEngagementRef = null
      },
      selectEngagement: (draft, engagementRef) => { draft.selectedEngagementRef = engagementRef },
      setDraft: (draft, value) => { draft.draft = value },
      setBusy: (draft, busy) => { draft.busy = busy },
      setError: (draft, error) => { draft.error = error },
    },
  })
}
