/**
 * Durable vocabulary contributed by the Claude driver. Types only.
 * @module @voyaseek-ai/dsh-claude-agent/types
 */

import type {} from '@voyaseek-ai/dsh-session/types'

declare module '@voyaseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The Claude-side conversation identity that drives this session. The
     * SDK keeps its own transcript under the Claude product home and resumes
     * it by this id, so the DSH log records the binding that lets a resumed
     * DSH session continue the same Claude conversation. Purely
     * informational: a reader that drops it only loses cross-restart
     * continuity, never transcript meaning.
     */
    'claude-agent/runtime': {
      /** SDK session id supplied to later queries as their `resume` target. */
      claudeSessionId: string
      /** Model the SDK reported for the query, when it advertised one. */
      model?: string
    }
  }
}
