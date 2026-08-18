/** Package-owned invariant companion for the test-only Cloud conformance fixture. */

import type { Context } from '@voyaseek-ai/cordis'
import type { InvariantInstaller } from '@voyaseek-ai/dsh-invariants'

const PACKAGE_NAME = '@voyaseek-ai/dsh-aistaff-cloud-conformance'

/** Cordis companion plugin name. */
export const name = 'aistaff-cloud-conformance-invariant'

/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package is a deterministic external-system test
 * fixture; cloud-client and cloud-provider own production runtime relations.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
