/**
 * Package-owned invariant companion for `@voyaseek-ai/dsh-claude-agent`.
 * @module @voyaseek-ai/dsh-claude-agent/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@voyaseek-ai/cordis'
import type { InvariantInstaller } from '@voyaseek-ai/dsh-invariants'

const PACKAGE_NAME = '@voyaseek-ai/dsh-claude-agent'

/** Cordis companion plugin name. */
export const name = 'claude-agent-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: turn/step pairing is enforced by the dsh-session log
 * invariant the driver appends through, and CLI process quiescence belongs to
 * the subprocess seam's process-tree owner.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - plugin context carrying the invariant registry.
 * @returns the installed registration's disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
