/** Package-owned invariant companion for the AI employee client product. */

import type { Context } from '@voyaseek-ai/cordis'
import type { InvariantInstaller } from '@voyaseek-ai/dsh-invariants'

const PACKAGE_NAME = '@voyaseek-ai/dsh-aistaff-client-product'

/** Cordis companion plugin name. */
export const name = 'aistaff-client-product-invariant'

/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package contributes two reversible presentation
 * entries and keeps all mutable state in their shared slot store.
 */
const install: InvariantInstaller = () => {}

/**
 * Register the package invariant companion.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns The registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
