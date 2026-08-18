import type {
  AistaffClientPort,
  CreateTaskInput,
  ProductError,
  RespondApprovalInput,
} from '@voyaseek-ai/dsh-aistaff-product-contracts'
import type { BoundActions } from '@voyaseek-ai/dsh-client-ui-slots'
import type { AistaffWorkbenchInjected } from './AistaffWorkbench.tsx'
import type { createAistaffProductStore } from './store.ts'

type ProductActions = BoundActions<ReturnType<typeof createAistaffProductStore>>

function showError(error: ProductError, actions: ProductActions): void {
  actions.setError(error.message)
}

function showConnectionError(actions: ProductActions): void {
  actions.setError('无法连接本地服务，请稍后重试')
}

async function refresh(port: AistaffClientPort, actions: ProductActions): Promise<boolean> {
  try {
    const result = await port.getSnapshot()
    if (!result.ok) {
      showError(result.error, actions)
      return false
    }
    actions.syncProjection(result.value)
    actions.setError(null)
    return true
  } catch {
    showConnectionError(actions)
    return false
  }
}

/**
 * Bind a Client Port to the shared store actions used by the workbench.
 * @param port - Replaceable product data Port.
 * @param actions - Bound actions for the shared root store.
 * @returns Plain callbacks safe to inject into the component.
 */
export function createWorkbenchInjected(
  port: AistaffClientPort,
  actions: ProductActions,
): AistaffWorkbenchInjected {
  return {
    refreshProjection: () => refresh(port, actions),
    createTask: async (input: CreateTaskInput) => {
      actions.setBusy(true)
      actions.setError(null)
      try {
        const result = await port.createTask(input)
        if (!result.ok) {
          showError(result.error, actions)
          return false
        }
        const synced = await refresh(port, actions)
        if (synced) actions.setDraftTitle('')
        return synced
      } catch {
        showConnectionError(actions)
        return false
      } finally {
        actions.setBusy(false)
      }
    },
    respondApproval: async (input: RespondApprovalInput) => {
      actions.setBusy(true)
      actions.setError(null)
      try {
        const result = await port.respondApproval(input)
        if (!result.ok) {
          showError(result.error, actions)
          return false
        }
        return refresh(port, actions)
      } catch {
        showConnectionError(actions)
        return false
      } finally {
        actions.setBusy(false)
      }
    },
  }
}
