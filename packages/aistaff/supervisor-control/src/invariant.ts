/** Package-owned invariant companion for the Supervisor control seam. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-aistaff-supervisor-control'

/** Cordis companion plugin name. */
export const name = 'aistaff-supervisor-control-invariant'

/** Service required before the companion can register. */
export const inject = ['invariants']

/** No runtime invariant: this Service Definition owns no provider state or event relationship. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
