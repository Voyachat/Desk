/** Public declaration face of the Cloud client wrapper. */

import type { ClientContext } from '@voyaseek-ai/dsh-client-runtime/client'

/** Client services required by the Cloud wrapper. */
export declare const inject: string[]

/**
 * Register the Cloud AI employee footer and workbench seats.
 * @param ctx - client root context carrying the production providers.
 */
export declare function apply(ctx: ClientContext): void
