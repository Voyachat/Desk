/** Package-owned invariant companion for the Settings-configured SQLite memory provider. */

import type { Context } from '@voyaseek-ai/cordis'
import type { InvariantInstaller } from '@voyaseek-ai/dsh-invariants'

const PACKAGE_NAME = '@voyaseek-ai/dsh-agent-memory-settings'
/** Cordis companion plugin name. */
export const name = 'agent-memory-settings-invariant'
/** Invariant registry required by this companion. */
export const inject = ['invariants']
// No runtime invariant: database open validation and Settings registration own the durable relationships.
const install: InvariantInstaller = () => {}
/** Register package invariant ownership. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
