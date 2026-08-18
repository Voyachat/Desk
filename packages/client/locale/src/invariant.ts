/**
 * Package-owned invariant companion for `@voyaseek-ai/dsh-client-locale`.
 * @module @voyaseek-ai/dsh-client-locale/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@voyaseek-ai/cordis'
import type { InvariantInstaller } from '@voyaseek-ai/dsh-invariants'

const PACKAGE_NAME = '@voyaseek-ai/dsh-client-locale'

/** Cordis companion plugin name. */
export const name = 'client-locale-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: settings validates the closed preference vocabulary,
 * agent-loop owns durable runtime-context projection, and this package's
 * behavior specs assert dictionary fallback, locale adoption, and prompt
 * resolution directly.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
