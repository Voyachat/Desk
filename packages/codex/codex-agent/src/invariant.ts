/** Package-owned invariant companion for the Codex agent driver. */

import type { Context } from '@voyaseek-ai/cordis'
import type { InvariantInstaller } from '@voyaseek-ai/dsh-invariants'

const PACKAGE_NAME = '@voyaseek-ai/dsh-codex-agent'

export const name = 'codex-agent-invariant'
export const inject = ['invariants']

/** Turn/step balance belongs to the session invariant; process trees belong to subprocess. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant ownership. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
