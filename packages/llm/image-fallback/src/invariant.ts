/** Package-owned invariant companion for `@voyaseek-ai/dsh-image-fallback`. */

/* jscpd:ignore-start */
import type { Context } from '@voyaseek-ai/cordis'
import type { InvariantInstaller } from '@voyaseek-ai/dsh-invariants'

const PACKAGE_NAME = '@voyaseek-ai/dsh-image-fallback'
/** Cordis companion plugin name. */
export const name = 'image-fallback-invariant'
/** Service required before package ownership can be reserved. */
export const inject = ['invariants']
/** No runtime invariant: each translation returns a detached operation-local value and owns no shared event stream. */
const install: InvariantInstaller = () => {}
/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
