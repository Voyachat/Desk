/** Package-owned invariant companion for the agent-memory service definition. */

import type { Context } from '@voyaseek-ai/cordis'
import type { InvariantInstaller } from '@voyaseek-ai/dsh-invariants'

const PACKAGE_NAME = '@voyaseek-ai/dsh-agent-memory'

/** Cordis companion plugin name. */
export const name = 'agent-memory-invariant'
/** Service required before package ownership can be registered. */
export const inject = ['invariants']

// No runtime invariant: the abstract service owns no mutable provider relationship.
const install: InvariantInstaller = () => {}

/** Register package invariant ownership. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
