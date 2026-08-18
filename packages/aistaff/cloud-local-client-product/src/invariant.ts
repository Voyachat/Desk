/** Package-owned invariant companion for the strict Cloud plus Local client wrapper. */

import type { Context } from '@voyaseek-ai/cordis'
import type { InvariantInstaller } from '@voyaseek-ai/dsh-invariants'

const PACKAGE_NAME = '@voyaseek-ai/dsh-aistaff-cloud-local-client-product'

/** Cordis companion plugin name. */
export const name = 'aistaff-cloud-local-client-product-invariant'

/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: Loader and Cordis injection prevent partial registration, while the slot
 * registry owns the lifecycle of the wrapper's reversible presentation registrations.
 */
const install: InvariantInstaller = () => {}

/**
 * Register the package invariant companion.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns The registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
