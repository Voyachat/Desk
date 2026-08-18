/**
 * Composer runtime-selector state: which agent driver the CURRENT session
 * runs under, and the progress of a switch.
 *
 * A session keeps the runtime it was created with (the history was produced
 * under that driver), so "switching" never mutates the current session: it
 * connects the session workspace under the chosen runtime — reusing a blank
 * session minted under it, else creating one — and opens the result. The
 * controller only carries the display state; the switch itself is an apply
 * closure over the sessions/workspaces services.
 */

import {
  createSnapshotStore, type SessionId, type SnapshotStore,
} from '@voyaseek-ai/dsh-client-runtime/client'

/** Selector snapshot. */
export interface RuntimeSelectorState {
  /** Runtime of the current session; empty string = default loop driver. */
  current: string
  /** The session the display follows, when one is current. */
  sessionId: SessionId | null
  /** A switch is in flight. */
  busy: boolean
  /** Last switch failure message, cleared by the next attempt. */
  error: string | null
}

const INITIAL: RuntimeSelectorState = {
  current: '', sessionId: null, busy: false, error: null,
}

/** Carries the composer runtime-selector display state. */
export class RuntimeSelectorController {
  /** Selector snapshot the renderer subscribes to. */
  readonly store: SnapshotStore<RuntimeSelectorState> = createSnapshotStore(INITIAL)

  private set(patch: Partial<RuntimeSelectorState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  /**
   * Follow the current session. Called on registration and on every list
   * move, so the chip always labels the session it sits under.
   * @param sessionId - the current session, or undefined when none.
   * @param runtime - its recorded runtime (absent = default loop driver).
   */
  sync(sessionId: SessionId | undefined, runtime: string | undefined): void {
    this.set({
      sessionId: sessionId ?? null,
      current: runtime ?? '',
      busy: false,
      error: null,
    })
  }

  /** Mark a switch in flight. */
  begin(): void {
    this.set({ busy: true, error: null })
  }

  /**
   * Record a failed switch.
   * @param message - user-visible failure line (errors stay English).
   */
  fail(message: string): void {
    this.set({ busy: false, error: message })
  }

  /** Clear the in-flight mark once a switch settles. */
  done(): void {
    this.set({ busy: false })
  }
}
