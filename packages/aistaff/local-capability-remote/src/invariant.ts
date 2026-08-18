/** Package-owned invariant companion for the local capability Remote bridge. */

import type { Context } from '@voyaseek-ai/cordis'
import type { InvariantInstaller } from '@voyaseek-ai/dsh-invariants'

const PACKAGE_NAME = '@voyaseek-ai/dsh-aistaff-local-capability-remote'

/** Cordis companion plugin name. */
export const name = 'aistaff-local-capability-remote-invariant'

/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: generated codecs and the explicit privilege-value
 * guard own wire validation; LocalCapabilityObjectLayer owns replacements.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
