/** Durable vocabulary contributed by the Codex driver. Types only. */

import type {} from '@voyaseek-ai/dsh-session/types'

declare module '@voyaseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The persistent Codex thread bound to this DSH session. A rebuilt driver
     * resumes this exact thread before accepting its next turn.
     */
    'codex-agent/runtime': {
      /** Codex app-server thread identity. */
      threadId: string
      /** Effective model when configured or reported by app-server. */
      model?: string
      /** Effective app-server model-provider id when configured or reported. */
      modelProvider?: string
    }
  }
}
