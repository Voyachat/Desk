/**
 * Runtime selector plugin, browser half: occupies the composer
 * `conversation.input.left` seat with a chip labeling the agent driver the
 * current session runs under — Native (the DSH loop), Claude (the Claude
 * Agent SDK driver), or Codex (the OpenAI Codex driver).
 *
 * A session never changes its own runtime. Switching a blank session connects
 * another blank session; switching after completed work forks the retained
 * transcript under the selected driver and opens that child.
 */

import type { ClientContext, SessionId } from '@voyaseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.left seat).
import type {} from '@voyaseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@voyaseek-ai/dsh-client-locale/client'
import { RuntimeSelector } from './RuntimeSelector.tsx'
import { RuntimeSelectorController } from './runtime-store.ts'
import { en, zh, type ClaudeRuntimeKey } from './locales.ts'

export type { ClaudeRuntimeKey } from './locales.ts'
export type { RuntimeSelectorState } from './runtime-store.ts'

declare module '@voyaseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The composer runtime selector's copy. */
    claudeRuntime: ClaudeRuntimeKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'claudeRuntime'

/** Injected business face of the composer runtime seat. */
export interface RuntimeSelectorInjected {
  hooks: {
    /** Selector snapshot bound by the renderer as useRuntimeSelector. */
    runtimeSelector: RuntimeSelectorController['store']
  }
  /**
   * Switch to the chosen runtime: connect the current workspace under it
   * and open the session that lands.
   * @param runtime - the runtime id; empty string selects the default loop.
   */
  select: (runtime: string) => void
  /** Dismiss the transient warning shown for a conversation handoff. */
  dismissWarning: () => void
}

/** Required services: the seat registry, locale, session and workspace faces. */
export const inject = ['slots', 'locale', 'sessions', 'workspaces']

/**
 * Client plugin body: register the runtime chip beside the composer chrome.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'claude-runtime-ui: dictionaries')

  // One controller for the whole tab: the display follows whichever session
  // is current, and a switch never belongs to one session alone.
  const controller = new RuntimeSelectorController()

  ctx.inject(['slots', 'sessions', 'workspaces'], (scope: ClientContext) => {
    const injected = (sessionId: SessionId): RuntimeSelectorInjected => ({
      hooks: { runtimeSelector: controller.store },
      select: (runtime: string) => { void switchRuntime(scope, controller, sessionId, runtime) },
      dismissWarning: () => { controller.dismissWarning() },
    })

    scope.effect(() => {
      const sync = (): void => {
        const state = scope.sessions.list.getSnapshot()
        const summary = state.current === undefined ? undefined : state.byId[state.current]
        controller.sync(state.current, summary?.agentRuntime, summary?.blank, summary?.running)
      }
      sync()
      const stop = scope.sessions.list.subscribe(sync)
      const registration = scope.slots.inject('conversation.input.left', () => scope.slots.register({
        name: 'conversation.input.left',
        id: 'claude-runtime',
        locale: NS,
        inject: injected,
      }, RuntimeSelector))
      return () => {
        stop()
        registration()
      }
    }, 'claude-runtime-ui: selector seat')
  })
}

/**
 * Resolve the workspace accounting for a session, falling back to the most
 * recent workspace: the switch must land somewhere the grouping surface can
 * show, and the recency projection is the same fallback New Session uses.
 * @param scope - context carrying the workspace list.
 * @param sessionId - the session the chip sits under.
 * @returns the workspace to connect, or undefined before baselines land.
 */
function workspaceFor(scope: ClientContext, sessionId: SessionId): string | undefined {
  const snapshot = scope.workspaces.list.getSnapshot()
  const owner = snapshot.items.find(item => item.sessionIds.includes(sessionId))
  return owner?.workspaceId ?? snapshot.recentWorkspaceId
}

/**
 * Execute a runtime switch. Blank sessions use ordinary workspace connection;
 * a non-blank session forks its latest completed turn under the target runtime
 * so visible history and DSH context remain available. A switch in flight
 * swallows further picks; a failure surfaces on the chip until the next attempt.
 * @param scope - context carrying session and workspace services.
 * @param controller - the display state carrier.
 * @param sessionId - the session the pick was made under.
 * @param runtime - the runtime id; empty string selects the default loop.
 */
async function switchRuntime(
  scope: ClientContext,
  controller: RuntimeSelectorController,
  sessionId: SessionId,
  runtime: string,
): Promise<void> {
  if (controller.store.getSnapshot().busy) return
  const workspaceId = workspaceFor(scope, sessionId)
  if (workspaceId === undefined) {
    controller.fail('no workspace available for the runtime switch')
    return
  }
  const summary = scope.sessions.list.getSnapshot().byId[sessionId]
  const carriesHistory = summary?.blank === false
  controller.begin(carriesHistory)
  try {
    const target = carriesHistory
      ? await scope.sessions.fork({ sessionId, agentRuntime: runtime })
      : await scope.workspaces.connectWorkspace(
        workspaceId as never,
        runtime === '' ? {} : { agentRuntime: runtime },
      )
    controller.done()
    if (target !== sessionId) scope.sessions.open(target)
  } catch (error) {
    controller.fail(error instanceof Error ? error.message : String(error))
  }
}
