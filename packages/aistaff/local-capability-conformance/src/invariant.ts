/** Package-owned invariant companion for the test-only local capability fixture. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-aistaff-local-capability-conformance'

/** Cordis companion plugin name. */
export const name = 'aistaff-local-capability-conformance-invariant'

/** Service required before the companion can register. */
export const inject = ['invariants']

/** No runtime invariant: the fixture delegates relationships to the production coordinator and Supervisor test provider. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
