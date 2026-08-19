/** Package-owned invariant companion for memory capture and recall. */

import type { Context } from '@voyaseek-ai/cordis'
import type { InvariantInstaller } from '@voyaseek-ai/dsh-invariants'

const PACKAGE_NAME = '@voyaseek-ai/dsh-agent-memory-context'
/** Cordis companion plugin name. */
export const name = 'agent-memory-context-invariant'
/** Invariant registry required by this companion. */
export const inject = ['invariants']
// No runtime invariant: event listeners contribute no independently queryable mutable relationship.
const install: InvariantInstaller = () => {}
/** Register package invariant ownership. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
