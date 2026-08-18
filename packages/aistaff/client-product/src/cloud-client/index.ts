/** Explicit production Cloud AI employee browser plugin. */

import type {
  EmployeeExperiencePort,
  ProductResult,
} from '@voyaseek-ai/dsh-aistaff-employee-experience'
import type { LocalCapabilityPort } from '@voyaseek-ai/dsh-aistaff-local-capability'
import type { ClientContext } from '@voyaseek-ai/dsh-client-runtime/client'
import type {} from '@voyaseek-ai/dsh-client-ui-layout/client'
import type {} from '@voyaseek-ai/dsh-client-ui-sidebar/client'
import { CloudAistaffFooterAction } from './CloudAistaffFooterAction.tsx'
import { CloudAistaffWorkbench } from './CloudAistaffWorkbench.tsx'
import { createCloudWorkbenchInjected, createLocalCapabilityWorkbenchInjected } from './adapter.ts'
import { createEmployeeExperienceExternalStore, createLocalCapabilityExternalStore } from './external-store.ts'
import { createCloudProductStore } from './store.ts'

/** Services required by the explicit production Cloud entry. */
export const inject = ['slots', 'employeeExperience']

/**
 * Register the existing DSH footer and overlay seats against the formal
 * Employee Experience service. This entry never detects or loads a Fixture.
 * @param ctx - Client root context carrying the explicit production provider.
 */
export function apply(ctx: ClientContext): void {
  const port: EmployeeExperiencePort = ctx.employeeExperience
  const externalStore = createEmployeeExperienceExternalStore(port)
  const localPort = ctx.get('localCapability') as LocalCapabilityPort | undefined
  const localExternalStore = localPort === undefined ? undefined : createLocalCapabilityExternalStore(localPort)
  const store = createCloudProductStore()
  const refreshExperience = async (): Promise<ProductResult<unknown>> => {
    const current = externalStore.getSnapshot().current_engagement
    if (current === null) {
      return {
        ok: false,
        error: {
          code: 'NOT_FOUND',
          message: '当前 AI 员工协作不存在，无法刷新本地操作结果。',
          retryable: false,
        },
      }
    }
    return port.readEngagement({ engagement_ref: current.engagement.engagement_ref })
  }
  ctx.effect(() => externalStore.dispose, 'aistaff-cloud-external-store')
  if (localExternalStore !== undefined) {
    ctx.effect(() => localExternalStore.dispose, 'aistaff-local-capability-external-store')
  }

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'aistaff-client-product',
    order: 10,
    store,
  }, CloudAistaffFooterAction))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'aistaff-client-product',
    order: 10,
    store,
    inject: actions => ({
      ...createCloudWorkbenchInjected(port, externalStore, actions),
      ...(localPort === undefined || localExternalStore === undefined
        ? {}
        : {
            localCapability: createLocalCapabilityWorkbenchInjected(
              localPort,
              localExternalStore,
              actions,
              refreshExperience,
            ),
          }),
    }),
  }, CloudAistaffWorkbench))
}

export type { CloudWorkbenchInjected, LocalCapabilityWorkbenchInjected } from './CloudAistaffWorkbench.tsx'
export { createCloudWorkbenchInjected, createLocalCapabilityWorkbenchInjected } from './adapter.ts'
export {
  createEmployeeExperienceExternalStore,
  createLocalCapabilityExternalStore,
  useEmployeeExperience,
  useLocalCapability,
} from './external-store.ts'
export { createCloudProductStore } from './store.ts'
