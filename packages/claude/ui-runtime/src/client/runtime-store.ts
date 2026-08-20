/**
 * Composer runtime-selector state: which agent driver the CURRENT session
 * runs under, and the progress of a switch.
 *
 * A session keeps the runtime it was created with. A blank-session switch
 * connects another blank session; a conversation switch forks its completed
 * history under the chosen runtime. The controller carries display, progress,
 * and the transient handoff warning; the switch itself is an apply closure
 * over the sessions/workspaces services.
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
  /** Whether the current session has no durable conversation history. */
  blank: boolean
  /** Whether the current session has an open driver turn. */
  running: boolean
  /** A switch is in flight. */
  busy: boolean
  /** Last switch failure message, cleared by the next attempt. */
  error: string | null
  /** Sequence key of the active cross-runtime warning toast. */
  warningSeq: number | null
}

const INITIAL: RuntimeSelectorState = {
  current: '', sessionId: null, blank: true, running: false,
  busy: false, error: null, warningSeq: null,
}

/** Carries the composer runtime-selector display state. */
export class RuntimeSelectorController {
  /** Selector snapshot the renderer subscribes to. */
  readonly store: SnapshotStore<RuntimeSelectorState> = createSnapshotStore(INITIAL)
  private nextWarningSeq = 0

  private set(patch: Partial<RuntimeSelectorState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  /**
   * Follow the current session. Called on registration and on every list
   * move, so the chip always labels the session it sits under.
   * @param sessionId - the current session, or undefined when none.
   * @param runtime - its recorded runtime (absent = default loop driver).
   * @param blank - whether it carries no durable conversation history.
   * @param running - whether its driver currently owns a turn.
   */
  sync(
    sessionId: SessionId | undefined,
    runtime: string | undefined,
    blank = true,
    running = false,
  ): void {
    this.set({
      sessionId: sessionId ?? null,
      current: runtime ?? '',
      blank,
      running,
      busy: false,
      error: null,
    })
  }

  /**
   * Mark a switch in flight and optionally announce history handoff.
   * @param warn - whether the switch crosses runtimes with retained history.
   */
  begin(warn: boolean): void {
    if (warn) this.nextWarningSeq += 1
    this.set({
      busy: true,
      error: null,
      ...(warn ? { warningSeq: this.nextWarningSeq } : {}),
    })
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

  /** Dismiss the transient history-handoff warning. */
  dismissWarning(): void {
    this.set({ warningSeq: null })
  }
}
