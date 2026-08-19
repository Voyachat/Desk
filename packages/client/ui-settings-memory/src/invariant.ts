/** Package-owned invariant companion for the memory settings page. */
import type { Context } from '@voyaseek-ai/cordis'
import type { InvariantInstaller } from '@voyaseek-ai/dsh-invariants'
const PACKAGE_NAME = '@voyaseek-ai/dsh-client-ui-settings-memory'
/** Cordis companion plugin name. */
export const name = 'client-ui-settings-memory-invariant'
/** Invariant registry required by this companion. */
export const inject = ['invariants']
// No runtime invariant: the Client slot ledger owns registration lifecycle and duplicate rejection.
const install: InvariantInstaller = () => {}
/** Register package invariant ownership. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
