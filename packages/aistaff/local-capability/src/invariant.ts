/** Package-owned invariant companion for local capability. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-aistaff-local-capability'

/** Cordis companion plugin name. */
export const name = 'aistaff-local-capability-invariant'

/** Service required before the companion can register. */
export const inject = ['invariants']

/** No runtime invariant: coordinator authority checks and complete replacements already assert owned relationships. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
