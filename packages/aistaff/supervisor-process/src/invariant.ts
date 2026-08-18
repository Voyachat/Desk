/** Package-owned invariant companion for the Rust Supervisor process transport. */

import type { Context } from '@voyaseek-ai/cordis'
import type { InvariantInstaller } from '@voyaseek-ai/dsh-invariants'

const PACKAGE_NAME = '@voyaseek-ai/dsh-aistaff-supervisor-process'

/** Cordis companion plugin name. */
export const name = 'aistaff-supervisor-process-invariant'

/** Service required before the companion can register. */
export const inject = ['invariants']

/** No runtime invariant: authenticated requests already validate child identity, bounds, and correlation at their commit point. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
