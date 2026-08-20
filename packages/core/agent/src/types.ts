/**
 * Durable agent session-event vocabulary shared with type-only consumers.
 *
 * @module @voyaseek-ai/dsh-agent/types
 */

import type { UserMessage } from '@voyaseek-ai/dsh-llm/types'

/** One of the two ordered pending-message lists owned by an agent. */
export type InboxTarget = 'next-turn' | 'next-step'

declare module '@voyaseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Records that a fork keeps the source transcript but starts its next
     * turn under another agent driver. An absent runtime names the native
     * loop. Alternative drivers use the marker to reject provider-private
     * continuation ids from the inherited prefix.
     */
    'agent/runtime/switched': {
      fromRuntime?: string
      toRuntime?: string
    }
    /**
     * One normalized mutation of an agent's durable pending-message lists.
     * Live dispatch precedes projection mutation, so synchronous observers may
     * read the pre-splice inbox to recover the removed messages.
     */
    'agent/inbox/spliced': {
      target: InboxTarget
      start: number
      removedCount?: number
      inserted: UserMessage[]
      outcome?: 'canceled'
    }
  }
}
