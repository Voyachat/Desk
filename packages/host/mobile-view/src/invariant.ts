/** Package-owned invariant companion for `@voyaseek-ai/dsh-mobile-view`. */

/* jscpd:ignore-start */
import type { Context } from '@voyaseek-ai/cordis'
import type { InvariantInstaller } from '@voyaseek-ai/dsh-invariants'
const PACKAGE_NAME = '@voyaseek-ai/dsh-mobile-view'
/** Cordis companion plugin name. */
export const name = 'mobile-view-invariant'
/** Service required before package ownership can be reserved. */
export const inject = ['invariants']
/** No runtime invariant: webserver registration disposal is checked by the owning route registry. */
const install: InvariantInstaller = () => {}
/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
