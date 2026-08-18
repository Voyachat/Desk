/** Package-owned invariant companion for the Aistaff product DTO package. */

import type { Context } from '@voyaseek-ai/cordis'
import type { InvariantInstaller } from '@voyaseek-ai/dsh-invariants'

const PACKAGE_NAME = '@voyaseek-ai/dsh-aistaff-product-contracts'

/** Cordis companion plugin name. */
export const name = 'aistaff-product-contracts-invariant'

/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package contains only JSON-compatible values and
 * zero-cost id branding, with no mutable data or event stream to compare.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
