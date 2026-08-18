/** Package-owned invariant companion for `@voyaseek-ai/dsh-tool-modelscope`. */

/* jscpd:ignore-start */
import type { Context } from '@voyaseek-ai/cordis'
import type { InvariantInstaller } from '@voyaseek-ai/dsh-invariants'
const PACKAGE_NAME = '@voyaseek-ai/dsh-tool-modelscope'
/** Cordis companion plugin name. */
export const name = 'tool-modelscope-invariant'
/** Service required before package ownership can be reserved. */
export const inject = ['invariants']
/** No runtime invariant: the tool registry owns contribution disposal and each result is operation-local. */
const install: InvariantInstaller = () => {}
/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
