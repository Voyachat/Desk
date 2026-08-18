/** Package-owned invariant companion for the test-only Cloud local conformance bundle. */

import type { Context } from '@voyaseek-ai/cordis'
import type { InvariantInstaller } from '@voyaseek-ai/dsh-invariants'

const PACKAGE_NAME = '@voyaseek-ai/dsh-aistaff-cloud-local-conformance-bundle'

/** Cordis companion plugin name. */
export const name = 'aistaff-cloud-local-conformance-bundle-invariant'

/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the bundle owns only static test composition; each inserted package owns
 * its runtime relationships.
 */
const install: InvariantInstaller = () => {}

/**
 * Register the bundle invariant companion.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns The registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
