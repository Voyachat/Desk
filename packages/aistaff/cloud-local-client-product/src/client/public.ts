/** Public declaration face of the strict Cloud and Local Capability wrapper. */

import type { ClientContext } from '@voyaseek-ai/dsh-client-runtime/client'

/** Client services required by the strict production wrapper. */
export declare const inject: string[]

/**
 * Register the Cloud workbench after all strict production services exist.
 * @param ctx - client root context carrying Cloud and Local Capability providers.
 */
export declare function apply(ctx: ClientContext): void
