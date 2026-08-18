/** Package-owned invariant companion for the Aistaff Cloud Client adapter. */

import type { Context } from '@voyaseek-ai/cordis'
import type { InvariantInstaller } from '@voyaseek-ai/dsh-invariants'

const PACKAGE_NAME = '@voyaseek-ai/dsh-aistaff-cloud-client'

/** Cordis companion plugin name. */
export const name = 'aistaff-cloud-client-invariant'

/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the pinned artifact validates every external value,
 * while EmployeeExperienceObjectLayer enforces replacement publication.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
