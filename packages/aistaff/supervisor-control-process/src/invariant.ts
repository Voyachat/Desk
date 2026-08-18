/** Package-owned invariant companion for the Rust Supervisor control provider. */

import type { Context } from '@voyaseek-ai/cordis'
import type { InvariantInstaller } from '@voyaseek-ai/dsh-invariants'

const PACKAGE_NAME = '@voyaseek-ai/dsh-aistaff-supervisor-control-process'

/** Cordis companion plugin name. */
export const name = 'aistaff-supervisor-control-process-invariant'

/** Service required before the companion can register. */
export const inject = ['invariants']

/** No runtime invariant: the provider retains no authority outside the Rust Supervisor's validated responses. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
