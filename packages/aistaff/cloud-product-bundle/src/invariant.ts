/** Package-owned invariant companion for the production Aistaff Cloud bundle. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-aistaff-cloud-product-bundle'

/** Cordis companion plugin name. */
export const name = 'aistaff-cloud-product-bundle-invariant'

/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the bundle owns only a static patch; each inserted package checks its own
 * runtime relationships.
 */
const install: InvariantInstaller = () => {}

/**
 * Register the bundle invariant companion.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns The registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
