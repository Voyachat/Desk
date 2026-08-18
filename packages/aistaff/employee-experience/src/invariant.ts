/** Package-owned invariants for the AI employee experience seam. */

import type { Context } from '@voyaseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@voyaseek-ai/dsh-invariants'
import type { EmployeeExperienceSnapshot } from './types.ts'

const PACKAGE_NAME = '@voyaseek-ai/dsh-aistaff-employee-experience'

/** Cordis companion plugin name. */
export const name = 'aistaff-employee-experience-invariant'

/** Services required before the companion can register. */
export const inject = ['invariants']

/** Assert that a published replacement is immutable at every nested object. */
function assertDeepFrozen(value: unknown, fail: InvariantFailure): void {
  if (value === null || typeof value !== 'object') return
  if (!Object.isFrozen(value)) fail('published Renderer projection contains a mutable object')
  for (const child of Object.values(value)) assertDeepFrozen(child, fail)
}

/** Observe the service contract and verify every initial or replacement value. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const check = (snapshot: EmployeeExperienceSnapshot): void => {
    assertDeepFrozen(snapshot, fail)
  }
  const observation = ctx.employeeExperience.observe(check)
  check(observation.snapshot)
  ctx.effect(() => observation.dispose)
}, { inject: ['employeeExperience'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns the registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
