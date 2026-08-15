/** Package-owned invariant companion for the test-only Cloud local-read composition. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-aistaff-cloud-local-conformance'

/** Cordis companion plugin name. */
export const name = 'aistaff-cloud-local-conformance-invariant'

/** Service required before the companion can register. */
export const inject = ['invariants']

/** No runtime invariant: production seams own the authoritative relationships. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
