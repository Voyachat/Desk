/** Additive AI employee browser plugin. */

import type { AistaffClientPort } from '@voyaseek-ai/dsh-aistaff-product-contracts'
import type {} from '@voyaseek-ai/dsh-aistaff-product-remote/client'
import type { ClientContext } from '@voyaseek-ai/dsh-client-runtime/client'
import type {} from '@voyaseek-ai/dsh-client-ui-layout/client'
import type {} from '@voyaseek-ai/dsh-client-ui-sidebar/client'
import { AistaffFooterAction } from './AistaffFooterAction.tsx'
import { AistaffWorkbench } from './AistaffWorkbench.tsx'
import { createWorkbenchInjected } from './adapter.ts'
import { createAistaffProductStore } from './store.ts'

/** Services required by the two declaration-aware Slot registrations. */
export const inject = ['slots', 'aistaffProductPort']

/**
 * Register the footer action and overlay workbench against their declaration lifetimes.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  const port: AistaffClientPort = ctx.aistaffProductPort
  const store = createAistaffProductStore()

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'aistaff-client-product',
    order: 10,
    store,
  }, AistaffFooterAction))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'aistaff-client-product',
    order: 10,
    store,
    inject: actions => createWorkbenchInjected(port, actions),
  }, AistaffWorkbench))
}

export type { AistaffWorkbenchInjected } from './AistaffWorkbench.tsx'
export { createAistaffProductStore } from './store.ts'
