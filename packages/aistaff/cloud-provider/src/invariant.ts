/** Package-owned invariant companion for the Aistaff Cloud provider composition. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-aistaff-cloud-provider'

/** Cordis companion plugin name. */
export const name = 'aistaff-cloud-provider-invariant'

/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: CloudClientGatewayAdapter and the Employee Experience
 * object layer own the wire and replacement relationships this composition mounts.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
