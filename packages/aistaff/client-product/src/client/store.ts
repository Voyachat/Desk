import type { ProductProjectionSnapshot } from '@deepseek-ai/dsh-aistaff-product-contracts'
import type { EmployeeId } from '@deepseek-ai/dsh-aistaff-product-contracts/types'
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** Shared interaction and projection state for both product entries. */
export interface AistaffProductState {
  open: boolean
  selectedEmployeeId: EmployeeId | null
  draftTitle: string
  projection: ProductProjectionSnapshot
  busy: boolean
  error: string | null
}

type AistaffProductActions = {
  openWorkbench: (draft: AistaffProductState) => void
  closeWorkbench: (draft: AistaffProductState) => void
  selectEmployee: (draft: AistaffProductState, employeeId: EmployeeId) => void
  setDraftTitle: (draft: AistaffProductState, title: string) => void
  syncProjection: (draft: AistaffProductState, projection: ProductProjectionSnapshot) => void
  setBusy: (draft: AistaffProductState, busy: boolean) => void
  setError: (draft: AistaffProductState, error: string | null) => void
}

/**
 * Create the root-scoped store shared by the footer action and workbench.
 * @param projection - Initial product projection.
 * @returns A fresh store handle.
 */
export function createAistaffProductStore(
  projection: ProductProjectionSnapshot = {
    revision: 0,
    employees: [],
    tasks: [],
    approvals: [],
    receipts: [],
  },
): EngineStoreHandle<AistaffProductState, AistaffProductActions> {
  return defineStore({
    init: (): AistaffProductState => ({
      open: false,
      selectedEmployeeId: projection.employees[0]?.id ?? null,
      draftTitle: '',
      projection,
      busy: false,
      error: null,
    }),
    actions: {
      openWorkbench: draft => { draft.open = true },
      closeWorkbench: draft => { draft.open = false },
      selectEmployee: (draft, employeeId: EmployeeId) => { draft.selectedEmployeeId = employeeId },
      setDraftTitle: (draft, title: string) => { draft.draftTitle = title },
      syncProjection: (draft, next: ProductProjectionSnapshot) => {
        draft.projection = next as AistaffProductState['projection']
        if (!next.employees.some(value => value.id === draft.selectedEmployeeId)) {
          draft.selectedEmployeeId = next.employees[0]?.id ?? null
        }
      },
      setBusy: (draft, busy: boolean) => { draft.busy = busy },
      setError: (draft, error: string | null) => { draft.error = error },
    },
  })
}
