/** Package-owned invariants for the Aistaff Host product projection. */

import type { Context } from '@voyaseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@voyaseek-ai/dsh-invariants'

const PACKAGE_NAME = '@voyaseek-ai/dsh-aistaff-product-projection'

/** Cordis companion plugin name. */
export const name = 'aistaff-product-projection-invariant'

/** Service required before the companion can register. */
export const inject = ['invariants']

/** Assert that each published event is the authoritative stream tail. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  ctx.aistaffProduct.subscribe((event) => {
    const history = ctx.aistaffProduct.eventHistory()
    if (history.at(-1) !== event) {
      fail(`published revision ${String(event.revision)} is not the authoritative event-stream tail`)
    }
  })
}, { inject: ['aistaffProduct'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns the registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
