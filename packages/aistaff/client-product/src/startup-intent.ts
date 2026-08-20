/** One-shot handoff from the Electron startup composer into the real Web product. */

import type { ConnectionHandle } from '@voyaseek-ai/dsh-api-remotes/client'
import type { ClientContext, ISessions } from '@voyaseek-ai/dsh-client-runtime/client'

interface StartupConversationInput {
  readonly input: {
    for(scope: ClientContext): { setDraft(text: string): void }
  }
}

/** User intent retained by Electron while the Web product starts. */
export interface DesktopStartupIntent {
  /** Plain text retained by the startup composer. */
  readonly draft: string
  /** Product mode selected before the Web runtime became available. */
  readonly agentPreset: 'standard' | 'code'
}

/** Narrow preload face exposed only by the Desktop application. */
export interface DesktopStartupBridge {
  /** @returns The retained intent, or null after it was acknowledged. */
  getIntent(): Promise<DesktopStartupIntent | null>
  /** @returns Completion after Electron removes the in-process retained intent. */
  acknowledge(): Promise<void>
}

type StartupGlobal = typeof globalThis & {
  readonly voyaseekStartup?: DesktopStartupBridge
}

function startupBridge(): DesktopStartupBridge | undefined {
  return (globalThis as StartupGlobal).voyaseekStartup
}

/**
 * Consume one retained Desktop intent after a real current blank Session exists.
 * The preset is confirmed before the draft is written, and Electron is
 * acknowledged only after both mutations succeed.
 * @param ctx - Client context with conversation, sessions, and connection services.
 * @param bridge - Desktop preload face captured before asynchronous work begins.
 */
export function installDesktopStartupHandoff(
  ctx: ClientContext,
  bridge: DesktopStartupBridge,
): void {
  const sessions = ctx.get('sessions') as ISessions | undefined
  const connection = ctx.get('connection') as ConnectionHandle | undefined
  if (sessions === undefined || connection === undefined || ctx.get('conversation') === undefined) {
    throw new Error('desktop startup handoff requires conversation, sessions, and connection services')
  }

  ctx.effect(() => {
    let disposed = false
    let stopped = false
    let applying = false
    let intent: DesktopStartupIntent | undefined
    let unsubscribe: (() => void) | undefined

    const stop = (): void => {
      if (stopped) return
      stopped = true
      unsubscribe?.()
      unsubscribe = undefined
    }

    const applyToCurrent = async (): Promise<void> => {
      if (disposed || stopped || applying || intent === undefined) return
      const state = sessions.list.getSnapshot()
      const sessionId = state.current
      if (sessionId === undefined || state.byId[sessionId]?.blank !== true) return

      const scope = sessions.scope(sessionId)
      if (scope === undefined) {
        stop()
        return
      }
      const conversation = scope.get('conversation') as StartupConversationInput | undefined
      if (conversation === undefined) {
        stop()
        return
      }

      applying = true
      try {
        const response = await connection.api.agentPresets.select({
          sessionId,
          agentPreset: intent.agentPreset,
        })
        if (!response.result.ok) {
          stop()
          return
        }
        const appliedPreset = response.result.value.agentPreset
        sessions.noteAgentPreset(sessionId, appliedPreset)
        conversation.input.for(scope).setDraft(intent.draft)
        await bridge.acknowledge()
        stop()
      } catch {
        // Unknown or rejected writes retain the Electron-owned intent. Retrying
        // here could duplicate a transport write whose outcome is unknown.
        stop()
      } finally {
        applying = false
      }
    }

    void bridge.getIntent().then((next) => {
      if (disposed || next === null) {
        stop()
        return
      }
      intent = next
      unsubscribe = sessions.list.subscribe(() => { void applyToCurrent() })
      void applyToCurrent()
    }, () => {
      stop()
    })

    return () => {
      disposed = true
      stop()
    }
  }, 'aistaff-client-product: Desktop startup intent handoff')
}

/**
 * Wait for the three real Web services before inspecting the Desktop bridge.
 * Browser-only deployments have no bridge and install no effects.
 * @param ctx - Client root context.
 */
export function registerDesktopStartupHandoff(ctx: ClientContext): void {
  const bridge = startupBridge()
  if (bridge === undefined) return
  ctx.inject(['conversation', 'sessions', 'connection'], (scope: ClientContext) => {
    installDesktopStartupHandoff(scope, bridge)
  })
}
