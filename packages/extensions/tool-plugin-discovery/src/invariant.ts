/** Package-owned invariant companion for plugin discovery. */

/* jscpd:ignore-start */
import type { Context } from '@voyaseek-ai/cordis'
import type { InvariantInstaller } from '@voyaseek-ai/dsh-invariants'

const PACKAGE_NAME = '@voyaseek-ai/dsh-tool-plugin-discovery'

/** Cordis companion plugin name. */
export const name = 'tool-plugin-discovery-invariant'
/** Service required before package ownership can be registered. */
export const inject = ['invariants']

/** No runtime invariant: the plugin owns no durable or cross-service relationship. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
