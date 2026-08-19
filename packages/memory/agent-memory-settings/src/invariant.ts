/** Package-owned invariant companion for the settings-backed memory provider. */

import type { Context } from '@voyaseek-ai/cordis'
import type { InvariantInstaller } from '@voyaseek-ai/dsh-invariants'

const PACKAGE_NAME = '@voyaseek-ai/dsh-agent-memory-settings'
/** Cordis companion plugin name. */
export const name = 'agent-memory-settings-invariant'
/** Invariant registry required by this companion. */
export const inject = ['invariants']
// No runtime invariant: Settings registration and schema validation own this provider's one durable relationship.
const install: InvariantInstaller = () => {}
/** Register package invariant ownership. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
