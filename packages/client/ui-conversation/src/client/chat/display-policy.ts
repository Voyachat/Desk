/**
 * Chat display policy. It owns the live inline-reasoning preference shared by
 * the chat view's fold grouping and its Settings row; the durable write goes
 * through the Host user-settings document when a scope is composed in.
 */
import {
  createSnapshotStore, type SettingsScope, type SnapshotStore,
} from '@voyaseek-ai/dsh-client-runtime/client'
import {
  DEFAULT_SHOW_REASONING, SHOW_REASONING_FIELD, type ConversationSettings,
} from '../../submission-settings.ts'

export { DEFAULT_SHOW_REASONING } from '../../submission-settings.ts'

/** Inline-reasoning preference used by both the chat view and its Settings row. */
export class ConversationDisplayPolicy {
  /** Reactive preference source for the Settings row and the chat view. */
  readonly showReasoning: SnapshotStore<boolean> = createSnapshotStore(DEFAULT_SHOW_REASONING)
  private readonly host: SettingsScope<ConversationSettings> | undefined

  /**
   * @param host - durable preference scope owned by the providing plugin;
   * absent compositions stay process-local. The adoption subscription shares
   * the scope's plugin lifetime — a disposed scope never publishes again, so
   * the policy needs no release hook.
   */
  constructor(host?: SettingsScope<ConversationSettings>) {
    this.host = host
    if (host !== undefined) {
      host.subscribe(() => { this.adopt(host) })
      this.adopt(host)
    }
  }

  /**
   * Change the inline-reasoning preference; the live value publishes before
   * the durable write starts.
   * @param show - whether reasoning steps render inline instead of folding.
   */
  setShowReasoning(show: boolean): void {
    if (this.showReasoning.getSnapshot() === show) return
    this.showReasoning.set(show)
    void this.host?.set(SHOW_REASONING_FIELD, show)
  }

  /**
   * Adopt the scope's accepted durable preference without writing it back.
   * @param host - the constructor-narrowed scope driving this adoption.
   */
  private adopt(host: SettingsScope<ConversationSettings>): void {
    const section = host.getSnapshot().value
    if (section === undefined || this.showReasoning.getSnapshot() === section.showReasoning) return
    this.showReasoning.set(section.showReasoning)
  }
}
