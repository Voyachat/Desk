/** Package-owned invariant companion for `@voyaseek-ai/dsh-client-ui-settings-mobile-view`. */

import type { Context } from '@voyaseek-ai/cordis'
import type { InvariantInstaller } from '@voyaseek-ai/dsh-invariants'

const PACKAGE_NAME = '@voyaseek-ai/dsh-client-ui-settings-mobile-view'

/** Cordis companion plugin name. */
export const name = 'client-ui-settings-mobile-view-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: wire codecs and the Host listener own validation and lifecycle enforcement. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant ownership. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
