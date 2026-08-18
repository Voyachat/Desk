/**
 * Package-owned invariant companion for `@voyaseek-ai/dsh-claude-runtime-ui`.
 * @module @voyaseek-ai/dsh-claude-runtime-ui/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@voyaseek-ai/cordis'
import type { InvariantInstaller } from '@voyaseek-ai/dsh-invariants'

const PACKAGE_NAME = '@voyaseek-ai/dsh-claude-runtime-ui'

/** Cordis companion plugin name. */
export const name = 'claude-runtime-ui-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this is a browser-side surface plugin whose node half
 * owns no event stream or mutable runtime data; the runtime a session runs
 * under is recorded on the session header and audited by dsh-session.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
